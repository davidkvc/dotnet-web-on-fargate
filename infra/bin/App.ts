#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { DotNetWebOnFargateStack } from '../lib/DotNetWebOnFargateStack';

const env = { account: '704646082799', region: 'eu-central-1' };

const app = new cdk.App();
const dotNetWebOnFargate = new DotNetWebOnFargateStack(app, "DotNetWebOnFargate", {
  env
});

cdk.Tags.of(dotNetWebOnFargate).add('stack-name', 'DotNetWebOnFargate');
