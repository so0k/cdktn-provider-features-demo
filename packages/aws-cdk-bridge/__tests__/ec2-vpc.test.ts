/**
 * Unit test: AWS CDK L2 VPC construct → CDKTN (Terraform via awscc provider)
 */

import { test } from "node:test";
import assert from "node:assert";
import { TerraformStack, Testing } from "cdktn";
import { Ec2Vpc } from "../../../.gen/providers/awscc/ec2-vpc/index.ts";
import { Vpc } from "../src/ec2/vpc.ts";

test("AWS CDK L2 VPC bridges transparently to CDKTN", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Use real aws-cdk-lib API, synthesizes to Terraform!
  const vpc = new Vpc(stack, "MyVpc", {
    maxAzs: 2,
  });

  // Verify VPC was created in CDKTN tree
  assert.ok(vpc.vpcId, "VPC ID is available");
  assert.ok(vpc.cidrBlock, "CIDR block is available");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);

  // Verify Terraform resource was created
  assert.ok(synthesized, "CDKTN synthesized successfully");

  // Parse synthesized Terraform JSON
  const tfJson = JSON.parse(synthesized);

  // Verify awscc_ec2_vpc resource exists
  const resources = tfJson?.resource?.awscc_ec2_vpc;
  assert.ok(resources, "awscc_ec2_vpc resource found in Terraform output");

  console.log("\n=== Synthesized Terraform (via awscc provider) ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("VPC bridge creates VPC with basic CIDR configuration", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Create VPC using the bridge convenience wrapper
  const vpc = new Vpc(stack, "TestVpc", {
    cidr: "10.0.0.0/16",
  });

  // Verify VPC properties are accessible
  assert.ok(vpc.vpcId, "VPC ID is available");
  assert.ok(vpc.cidrBlock, "VPC CIDR block is available");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify VPC resource exists
  const vpcResources = tfJson?.resource?.awscc_ec2_vpc;
  assert.ok(vpcResources, "awscc_ec2_vpc resource found");

  const vpcResource = Object.values(vpcResources)[0] as any;
  assert.strictEqual(vpcResource.cidr_block, "10.0.0.0/16", "CIDR block matches");
  assert.strictEqual(vpcResource.enable_dns_support, true, "DNS support enabled by default");

  console.log("\n=== VPC Resource ===");
  console.log(JSON.stringify(vpcResource, null, 2));
});
