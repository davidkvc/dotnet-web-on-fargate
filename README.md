# DotNet Web App on AWS Fargate

This repository contains AWS CDK project for demo ASP.Net Core 5 application
hosted on AWS Fargate. It is my playground for learning AWS.

Below diagram illustrates important architecture components and interactions of this project.
> The diagram might not always be up to date with the code

![](AWS%20architecture%20diagram.png)

## Notable problems solved in this project

* Deploying dockerized dotnet app on ECS
* Configuring ECS to use exposed app's healthcheck endpoint on non-public port
* Configuring ELB to use the same healthcheck endpoint
  * with required security group modifications
  * healthcheck is only exposed internally. Can not be requested from the internet
* Log processing by sidecar Fluentbit container with CloudWatch target
  * allows us to define advanced log processing pipeline 
  * processes logs from files instead of app's stdout
* Sharing filesystem across multiple containers
* Sidecar nginx reverse proxy
  * allows us to configure some common behaviour outside of the app. E.g. compression.
  * it really is just an example how to do it if we need it
* Secrets management using SSM Parameter Store
  * secrets are stores as single SSM parameter encoded as JSON document
  * app downloads secrets to local filesystem on startup
* Automatic app redeployment on secret change
  * example of configuration that will ensure that when SSM parameter is updated app is redeployed and downloads the latest value
* Custom metrics from app's logs
* CloudWatch Dashboard with custom metrics
* Utilizing CloudMap's service discovery for direct app-to-app communication

## Repository contents

* `infra` - CDK project directory
* `app` - application code + other required Docker image definitions
