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
import * as dynamo from '@aws-cdk/aws-dynamodb';

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
            },
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

        const dashboard = new cw.Dashboard(this, `DotNetWebOnFargateDashboard`, {
            dashboardName: 'DotNetWebOnFargate',
        });
        dashboard.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        this.addWebApp({
            appName: 'dotnet-web-on-fargate',
            componentName: 'alpha',
            secretsParameterName, vpc, cluster,
            serviceSecurityGroup: sgApp,
            nginxContainer: nginxContainer,
            fluentbitContainer: fluentbitContainer,
            apiContainer: ecs.ContainerImage.fromAsset('../app/DotNetWebOnFargate.Alpha.Api'),
            dashboard,
        });

        const betaApp = this.addWebApp({
            appName: 'dotnet-web-on-fargate',
            componentName: 'beta',
            secretsParameterName, vpc, cluster,
            serviceSecurityGroup: sgApp,
            nginxContainer: nginxContainer,
            fluentbitContainer: fluentbitContainer,
            apiContainer: ecs.ContainerImage.fromAsset('../app/DotNetWebOnFargate.Beta.Api'),
            dashboard,
        });

        const table = new dynamo.Table(this, "dotnetwebonfargate", {
            tableName: "dotnetwebonfargate",
            billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
            partitionKey: {
                name: 'region',
                type: dynamo.AttributeType.STRING
            }
        });
        table.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
        table.grantReadWriteData(betaApp.task.taskRole);

        // this.addWebApp({
        //     appName: 'client',
        //     secretsParameterName, vpc, cluster,
        //     serviceSecurityGroup: sgApp,
        //     nginxContainer: nginxContainer,
        //     fluentbitContainer: fluentbitContainer,
        //     apiContainer: ecs.ContainerImage.fromAsset('../app/DotNetWebOnFargate.Client.Api'),
        // });
    }

    addWebApp(props: {
        appName: string,
        componentName: string,
        secretsParameterName: string, 
        vpc: ec2.IVpc, 
        serviceSecurityGroup: ec2.SecurityGroup,
        cluster: ecs.ICluster,
        nginxContainer: ecs.AssetImage,
        apiContainer: ecs.AssetImage,
        fluentbitContainer: ecs.AssetImage,
        dashboard: cw.Dashboard,
    }): {
        task: ecs.TaskDefinition
    } {
        const serviceLogs = new logs.LogGroup(this, `${props.componentName}-ServiceLogs`, {
            retention: logs.RetentionDays.ONE_DAY,
            logGroupName: `/dotnet-web-on-fargate/service/${props.componentName}`
        });
        serviceLogs.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const appLogs = new logs.LogGroup(this, `${props.componentName}-AppLogs`, {
            retention: logs.RetentionDays.ONE_WEEK,
            logGroupName: `/dotnet-web-on-fargate/app/${props.componentName}`,
        });
        appLogs.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const taskDefinition = new ecs.FargateTaskDefinition(this, `${props.componentName}-TaskDef`, {
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
                "logs:PutRetentionPolicy",
                "xray:*",
                "ssm:GetParameters"
            ],
            "Resource": "*"
        });
        taskDefinition.addToTaskRolePolicy(allowLogsManagementPolicy);

        const containerLogging = ecs.LogDriver.awsLogs({
            streamPrefix: props.componentName,
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
                ],
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

        //https://aws-otel.github.io/docs/setup/ecs/task-definition-for-ecs-fargate
        //https://github.com/aws-observability/aws-otel-collector/blob/main/config/ecs/container-insights/otel-task-metrics-config.yaml
        const otelContainer = taskDefinition.addContainer("otel-collector", {
            image: ecs.ContainerImage.fromRegistry("amazon/aws-otel-collector"),
            command: ["--config=/etc/ecs/container-insights/otel-task-metrics-config.yaml"],
            logging: containerLogging,
        });

        const appService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, `${props.componentName}Service`, {
            cluster: props.cluster,
            cpu: 256,
            desiredCount: 1,
            taskDefinition: taskDefinition,
            memoryLimitMiB: 512,
            publicLoadBalancer: true,
            securityGroups: [props.serviceSecurityGroup],
            cloudMapOptions: {
                name: props.componentName
            },
            //deployment completes fater but we have some downtime
            minHealthyPercent: 0,
        });
        appService.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "5");

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
            port: "81",
            healthyThresholdCount: 2,
            interval: cdk.Duration.seconds(5),
            timeout: cdk.Duration.seconds(4),
        });
        appService.listener.connections.allowTo(props.serviceSecurityGroup, ec2.Port.tcp(81), "for health check");

        new events.Rule(this, `${props.componentName}-RedeployOnSecretsChange`, {
            description: `Redeploy ${props.componentName} on secrets config change`,
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

        const responseTimeMf = appLogs.addMetricFilter(`${props.componentName}-ResponseTimeMf`, {
            filterPattern: logs.FilterPattern.stringValue('$.EventId.Name', '=', 'RequestFinished'),
            metricNamespace: props.appName,
            metricName: `${props.componentName}-latency`,
            metricValue: '$.ElapsedMilliseconds',
        });
        responseTimeMf.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const requestsMf = appLogs.addMetricFilter(`${props.componentName}-RequestsMf`, {
            filterPattern: logs.FilterPattern.stringValue('$.EventId.Name', '=', 'RequestFinished'),
            metricNamespace: props.appName,
            metricName: `${props.componentName}-requests`,
            metricValue: '1',
        });
        requestsMf.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        const errorsMf = appLogs.addMetricFilter(`${props.componentName}-ErrorsMf`, {
            filterPattern: logs.FilterPattern.all(
                logs.FilterPattern.stringValue('$.EventId.Name', '=', 'RequestFinished'),
                logs.FilterPattern.numberValue('$.StatusCode', '>=', 500),
            ),
            metricNamespace: props.appName,
            metricName: `${props.componentName}-errors`,
            metricValue: '1',
        });
        errorsMf.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

        props.dashboard.addWidgets(
            new cw.GraphWidget({
                title: `[${props.componentName}] P90 latency`,

                left: [responseTimeMf.metric({
                    statistic: 'p90.00',
                    period: cdk.Duration.minutes(5),
                    unit: cw.Unit.MILLISECONDS,
                })],

                liveData: true,
            }),
            new cw.GraphWidget({
                title: `[${props.componentName}] rpm`,

                left: [requestsMf.metric({
                    unit: cw.Unit.COUNT,
                    period: cdk.Duration.minutes(1),
                    statistic: 'n',
                })],
                leftYAxis: {
                    min: 0
                },

                liveData: true,
            }),
            new cw.GraphWidget({
                title: `[${props.componentName}] errors`,

                left: [errorsMf.metric({
                    unit: cw.Unit.COUNT,
                    period: cdk.Duration.minutes(5),
                    statistic: 'n',
                    color: cw.Color.RED,
                })],
                leftYAxis: {
                    min: 0
                },

                liveData: true,
            }),
            new cw.GraphWidget({
                title: `[${props.componentName}] CPU utilization`,

                width: 12,

                left: [
                    new cw.Metric({
                        namespace: 'AWS/ECS',
                        metricName: 'CPUUtilization',
                        dimensions: {
                            ServiceName: appService.service.serviceName,
                            ClusterName: appService.cluster.clusterName
                        },
                        statistic: 'avg',
                        label: 'avg CPU utilization',
                    }),
                    new cw.Metric({
                        namespace: 'AWS/ECS',
                        metricName: 'CPUUtilization',
                        dimensions: {
                            ServiceName: appService.service.serviceName,
                            ClusterName: appService.cluster.clusterName
                        },
                        statistic: 'max',
                        label: 'max CPU utilization',
                    })
                ],
                leftYAxis: {
                    min: 0,
                    max: 100
                },

                liveData: true,
            }),
            new cw.GraphWidget({
                title: `[${props.componentName}] MEMORY utilization`,

                width: 12,

                left: [
                    new cw.Metric({
                        namespace: 'AWS/ECS',
                        metricName: 'MemoryUtilization',
                        dimensions: {
                            ServiceName: appService.service.serviceName,
                            ClusterName: appService.cluster.clusterName
                        },
                        statistic: 'avg',
                        label: 'avg MEMORY utilization',
                    }),
                    new cw.Metric({
                        namespace: 'AWS/ECS',
                        metricName: 'MemoryUtilization',
                        dimensions: {
                            ServiceName: appService.service.serviceName,
                            ClusterName: appService.cluster.clusterName
                        },
                        statistic: 'max',
                        label: 'max MEMORY utilization',
                    })
                ],
                leftYAxis: {
                    min: 0,
                    max: 100
                },

                liveData: true,
            }),
            new cw.LogQueryWidget({
                title: `[${props.componentName}] most recent unhandled exceptions`,

                width: 24,

                logGroupNames: [appLogs.logGroupName],
                queryLines: [
                    "fields @timestamp, @message",
                    "filter EventId.Name = 'UnhandledException'",
                    "sort @timestamp desc",
                    "limit 100",
                ]
            }),
        );

        new cdk.CfnOutput(this, `${props.componentName}ApiDocsUrl`, {
            value: `http://${appService.loadBalancer.loadBalancerDnsName}/swagger`
        })

        return {
            task: taskDefinition
        }
    }
}