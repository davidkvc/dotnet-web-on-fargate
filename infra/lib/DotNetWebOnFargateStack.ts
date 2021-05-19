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

        const vpc = new ec2.Vpc(this, "Vpc", {
            //at least 2 are required by ECS
            maxAzs: 2
        });

        const cluster = new ecs.Cluster(this, "Cluster", {
            vpc: vpc,
            //containerInsights: true,
            defaultCloudMapNamespace: {
                name: 'dotnetwebonfargate'
            }
        });

        const sgApp = new ec2.SecurityGroup(this, 'sg-app', {
            vpc: vpc,
        });
        sgApp.connections.allowInternally(ec2.Port.tcp(80), 'internal communication');

        const nginxContainer = ecs.ContainerImage.fromAsset('../app/nginx');
        const fluentbitContainer = ecs.ContainerImage.fromAsset('../app/CustomFluentbit');

        // * main and client each have it's own public load balancer
        //      * not optimal, one domain would be optimal for multiple apps. I don't care at this point
        //      * we could 
        //          * share LB with appropriate routing rules
        //          * utlize API Gateway
        //          * make these apps completely internal and create another app with nginx only that would route traffic between services
        // * client calls main - client's /whatever is forwarded to main's /whatever
        // * client calls main directly, utilizing CloudMap. main's internal DNS name is main.dotnetwebonfargate

        this.addWebApp({
            appName: 'main',
            secretsParameterName, vpc, cluster,
            serviceSecurityGroup: sgApp,
            nginxContainer: nginxContainer,
            fluentbitContainer: fluentbitContainer,
            apiContainer: ecs.ContainerImage.fromAsset('../app/DotNetWebOnFargate.Api'),
        });

        this.addWebApp({
            appName: 'client',
            secretsParameterName, vpc, cluster,
            serviceSecurityGroup: sgApp,
            nginxContainer: nginxContainer,
            fluentbitContainer: fluentbitContainer,
            apiContainer: ecs.ContainerImage.fromAsset('../app/DotNetWebOnFargate.Client.Api'),
        });
    }

    addWebApp(props: {
        appName: string,
        secretsParameterName: string, 
        vpc: ec2.IVpc, 
        serviceSecurityGroup: ec2.SecurityGroup,
        cluster: ecs.ICluster,
        nginxContainer: ecs.AssetImage,
        apiContainer: ecs.AssetImage,
        fluentbitContainer: ecs.AssetImage
    }) {
        const serviceLogs = new logs.LogGroup(this, `${props.appName}-ServiceLogs`, {
            retention: logs.RetentionDays.ONE_DAY,
            logGroupName: `/dotnet-web-on-fargate/service/${props.appName}`
        });
        serviceLogs.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const appLogs = new logs.LogGroup(this, `${props.appName}-AppLogs`, {
            retention: logs.RetentionDays.ONE_WEEK,
            logGroupName: `/dotnet-web-on-fargate/app/${props.appName}`,
        });
        appLogs.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const taskDefinition = new ecs.FargateTaskDefinition(this, `${props.appName}-TaskDef`, {
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

        const containerLogging = ecs.LogDriver.awsLogs({
            streamPrefix: props.appName,
            logRetention: logs.RetentionDays.ONE_DAY,
            logGroup: serviceLogs
        });

        const nginxContainer = taskDefinition.addContainer('nginx', {
            image: props.nginxContainer,
            portMappings: [
                {
                    containerPort: 80,
                    hostPort: 80,
                    protocol: ecs.Protocol.TCP
                }
            ],
            logging: containerLogging,
        });

        const apiContainer = taskDefinition.addContainer("api", {
            image: props.apiContainer,
            portMappings: [
                // for LB health check
                {
                    containerPort: 81,
                    hostPort: 81,
                    protocol: ecs.Protocol.TCP
                }
            ],
            logging: containerLogging,
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
            "Resource": `arn:aws:ssm:*:*:parameter${props.secretsParameterName}`
        });
        taskDefinition.addToTaskRolePolicy(allowGetSecretsParameterPolicy);

        const logsContainer = taskDefinition.addContainer("fluentbit", {
            image: props.fluentbitContainer,
            logging: containerLogging,
            environment: {
                REGION: this.region,
                LOG_GROUP_NAME: appLogs.logGroupName
            }
        });
        logsContainer.addMountPoints({
            containerPath: '/logs',
            sourceVolume: 'logs',
            //writes logs DB
            readOnly: false
        });

        const appService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `${props.appName}Service`, {
            cluster: props.cluster,
            cpu: 256,
            desiredCount: 1,
            taskDefinition: taskDefinition,
            memoryLimitMiB: 512,
            publicLoadBalancer: true,
            securityGroups: [props.serviceSecurityGroup],
            cloudMapOptions: {
                name: props.appName
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
        appService.listener.connections.allowTo(props.serviceSecurityGroup, ec2.Port.tcp(81), "for health check");

        new events.Rule(this, `${props.appName}-RedeployOnSecretsChange`, {
            description: `Redeploy ${props.appName} on secrets config change`,
            eventPattern: {
                source: ["aws.ssm"],
                detailType: ["Parameter Store Change"],
                detail: {
                    name: [props.secretsParameterName],
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
                        cluster: props.cluster.clusterName,
                        service: appService.service.serviceName,
                        forceNewDeployment: true
                    }
                })
            ]
        });

        const mf = appLogs.addMetricFilter(`${props.appName}-ResponseTimesMf`, {
            filterPattern: logs.FilterPattern.stringValue('$.EventId.Name', '=', 'RequestFinished'),
            metricNamespace: props.appName,
            metricName: 'response time ms',
            metricValue: '$.ElapsedMilliseconds',
        });
        mf.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const dashboard = new cw.Dashboard(this, `${props.appName}Dashboard`, {
            dashboardName: props.appName,
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

        new cdk.CfnOutput(this, `${props.appName}ApiDocsUrl`, {
            value: `http://${appService.loadBalancer.loadBalancerDnsName}/swagger`
        })
    }
}