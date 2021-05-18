import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as iam from "@aws-cdk/aws-iam";
import * as ssm from '@aws-cdk/aws-ssm';
import * as events from "@aws-cdk/aws-events";
import * as eventTargets from "@aws-cdk/aws-events-targets";
import * as logs from '@aws-cdk/aws-logs';
import * as cw from '@aws-cdk/aws-cloudwatch';

export class DotNetWebOnFargateStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        //aws ssm get-parameter --name /david/dotnetwebonfargate/secrets --with-decryption
        //aws ssm put-parameter --name /david/dotnetwebonfargate/secrets --type SecureString --value '{""password"": ""test""}' --overwrite
        const secretsParameterName = '/david/dotnetwebonfargate/secrets';

        const vpc = new ec2.Vpc(this, "DotNetWebOnFargateVpc", {
            //at least 2 are required by ECS
            maxAzs: 2
        });

        const cluster = new ecs.Cluster(this, "DotNetWebOnFargateCluster", {
            vpc: vpc,
            //containerInsights: true
        });
        const cloudMapNamespace = cluster.addDefaultCloudMapNamespace({
            name: 'dotnetwebonfargate',
        });

        const taskDefinition = new ecs.FargateTaskDefinition(this, "DotNetWebOnFargateTaskDefinition", {
            volumes: [
                {
                    name: 'logs'
                }
            ],
        });
        taskDefinition.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
        const allowLogsManagementPolicy = iam.PolicyStatement.fromJson({
            "Sid": "AllowLogsManagement",
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
                "logs:PutRetentionPolicy"
            ],
            "Resource": "*"
        });
        taskDefinition.addToTaskRolePolicy(allowLogsManagementPolicy);

        const nginxContainer = taskDefinition.addContainer('nginx', {
            image: ecs.ContainerImage.fromAsset('../DotNetWebOnFargate/nginx'),
            portMappings: [
                {
                    containerPort: 80,
                    hostPort: 80,
                    protocol: ecs.Protocol.TCP
                }
            ],
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: 'DotNetWebOnFargate.nginx',
                logRetention: logs.RetentionDays.ONE_DAY
            }),
        });

        const apiContainer = taskDefinition.addContainer("api", {
            image: ecs.ContainerImage.fromAsset('../DotNetWebOnFargate/DotNetWebOnFargate.Api'),
            portMappings: [
                // for LB health check
                {
                    containerPort: 81,
                    hostPort: 81,
                    protocol: ecs.Protocol.TCP
                }
            ],
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: 'DotNetWebOnFargate.Api',
                logRetention: logs.RetentionDays.ONE_DAY
            }),
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    "/bin/bash -c '[[ \"$(curl -s -o /dev/null -w \"%{http_code}\" http://localhost:81/_health)\" == \"200\" ]] && exit 0 || exit 1'"
                ]
            },
        });
        apiContainer.addMountPoints({
            containerPath: '/logs',
            sourceVolume: 'logs',
            readOnly: false
        });
        const allowGetSecretsParameterPolicy = iam.PolicyStatement.fromJson({
            "Sid": "AllowGetSecretsParameter",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter"
            ],
            "Resource": `arn:aws:ssm:*:*:parameter${secretsParameterName}`
        });
        taskDefinition.addToTaskRolePolicy(allowGetSecretsParameterPolicy);

        const logsContainer = taskDefinition.addContainer("fluentbit", {
            //TODO pull from AWS internal registry
            //aws ssm get-parameter --name /aws/service/aws-for-fluent-bit/stable
            //image: ecs.ContainerImage.fromRegistry("public.ecr.aws/aws-observability/aws-for-fluent-bit:stable"),
            image: ecs.ContainerImage.fromAsset('../DotNetWebOnFargate/CustomFluentbit'),
            logging: ecs.LogDriver.awsLogs({
                streamPrefix: 'DotNetWebOnFargate.Fluentbit',
                logRetention: logs.RetentionDays.ONE_DAY
            }),
        });
        logsContainer.addMountPoints({
            containerPath: '/logs',
            sourceVolume: 'logs',
            //writes logs DB
            readOnly: false
        });

        const sgApp = new ec2.SecurityGroup(this, "sg-app", {
            vpc: vpc,
        });

        const appService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "DotNetWebOnFargateService", {
            cluster: cluster,
            cpu: 256,
            desiredCount: 1,
            taskDefinition: taskDefinition,
            memoryLimitMiB: 512,
            publicLoadBalancer: true,
            securityGroups: [sgApp],
            cloudMapOptions: {
                name: 'api',
                cloudMapNamespace: cloudMapNamespace,
            },
        });

        //uncomment if you want to enable autoscaling
        // const autoScaling = appService.service.autoScaleTaskCount({
        //     maxCapacity: 4
        // });
        // autoScaling.scaleOnCpuUtilization("cpuAutoScaling", {
        //     targetUtilizationPercent: 70
        // });

        // configure LB health check
        appService.targetGroup.configureHealthCheck({
            path: '/_health',
            port: "81"
        });
        appService.listener.connections.allowTo(sgApp, ec2.Port.tcp(81), "for health check");

        new events.Rule(this, "RedeployOnSecretsChange", {
            description: "Redeploy DotNetWebOnFargate on secrets config change",
            eventPattern: {
                source: ["aws.ssm"],
                detailType: ["Parameter Store Change"],
                detail: {
                    name: [secretsParameterName],
                    operation: [
                        "Create",
                        "Update",
                        "Delete",
                        "LabelParameterVersion"
                    ]
                }
            },
            targets: [
                //TODO: configure log retention for lambda created by this target
                new eventTargets.AwsApi({
                    service: 'ECS',
                    action: 'updateService',
                    parameters: {
                        cluster: cluster.clusterName,
                        service: appService.service.serviceName,
                        forceNewDeployment: true
                    }
                })
            ]
        });

        const appLogs = new logs.LogGroup(this, 'app-logs', {
            retention: logs.RetentionDays.ONE_WEEK,
            logGroupName: 'dotnet-web-on-fargate',
        });
        appLogs.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const mf = appLogs.addMetricFilter('ResponseTimesMf', {
            filterPattern: logs.FilterPattern.stringValue('$.EventId.Name', '=', 'RequestFinished'),
            metricNamespace: 'DotNetWebOnFargate',
            metricName: 'response time ms',
            metricValue: '$.ElapsedMilliseconds',
        });
        mf.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const dashboard = new cw.Dashboard(this, 'Dashboard', {
            dashboardName: 'DotNetOnFargate',
        });
        dashboard.addWidgets(
            new cw.SingleValueWidget({
                metrics: [mf.metric({
                    statistic: 'p90.00',
                    period: cdk.Duration.minutes(30),
                })],
                title: 'P90 response duration'
            }),
            new cw.SingleValueWidget({
                metrics: [mf.metric({
                    statistic: 'max',
                    period: cdk.Duration.minutes(30),
                })],
                title: 'max response duration'
            })
        );
        dashboard.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        new cdk.CfnOutput(this, "ApiDocsUrl", {
            value: `http://${appService.loadBalancer.loadBalancerDnsName}/swagger`
        })
    }
}