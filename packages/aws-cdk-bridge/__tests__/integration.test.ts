/**
 * Integration test: Multiple AWS CDK L2 constructs working together
 */

import { test } from "node:test";
import assert from "node:assert";
import { TerraformStack, Testing } from "cdktn";
import { AwsccProvider } from "../../../.gen/providers/awscc/provider/index.ts";
import { Vpc } from "../src/ec2/vpc.ts";
import { Stream } from "../src/kinesis/stream.ts";

test("Multiple AWS CDK L2 resources bridge together", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Configure awscc provider
  new AwsccProvider(stack, "awscc", {
    region: "us-east-1",
  });

  // Create VPC
  const vpc = new Vpc(stack, "MyVpc", {
    maxAzs: 2,
    cidr: "10.0.0.0/16",
  });

  // Create Kinesis Stream
  const stream = new Stream(stack, "MyStream", {
    streamName: "my-data-stream",
    shardCount: 1,
  });

  // Verify all resources were created
  assert.ok(vpc.vpcId, "VPC ID is available");
  assert.ok(stream.streamArn, "Stream ARN is available");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);
  assert.ok(synthesized, "CDKTN synthesized successfully");

  // Parse synthesized Terraform JSON
  const tfJson = JSON.parse(synthesized);

  // Verify all resources exist
  const vpcResources = tfJson?.resource?.awscc_ec2_vpc;
  const subnetResources = tfJson?.resource?.awscc_ec2_subnet;
  const routeResources = tfJson?.resource?.awscc_ec2_route;
  const streamResources = tfJson?.resource?.awscc_kinesis_stream;

  assert.ok(vpcResources, "VPC resources found");
  assert.ok(subnetResources, "Subnet resources found");
  assert.ok(routeResources, "Route resources found");
  assert.ok(streamResources, "Kinesis Stream resources found");

  // VPC creates multiple resources (VPC itself, potentially subnets, route tables, etc.)
  const vpcKeys = Object.keys(vpcResources);
  assert.ok(vpcKeys.length >= 1, "At least one VPC resource created");

  const streamKeys = Object.keys(streamResources);
  assert.strictEqual(streamKeys.length, 1, "One Kinesis Stream resource created");

  console.log("\n=== Integration Test: Multiple Resources ===");
  console.log(`VPC Resources: ${vpcKeys.length}`);
  console.log(`Stream Resources: ${streamKeys.length}`);
  console.log("\n=== Full Terraform Output ===");
  console.log(JSON.stringify(tfJson, null, 2));
});
