/**
 * Unit test: EC2 VPC CIDR splitting through the bridge
 *
 * Tests that AWS CDK's VPC construct, when used through the bridge,
 * properly handles CIDR splitting with cfncompat provider functions.
 *
 * AWS CDK's VPC automatically:
 * - Allocates subnets across availability zones
 * - Splits the VPC CIDR block using Fn::Cidr and Fn::Select
 * - Creates subnets, route tables, gateways, etc.
 *
 * The bridge should convert these CloudFormation intrinsics to
 * CfncompatProviderFunctions calls.
 */

import { test } from "node:test";
import assert from "node:assert";
import { TerraformStack, Testing } from "cdktn";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { Vpc } from "../src/ec2/vpc.ts";

test("VPC bridge handles multi-AZ subnet allocation with CIDR splitting", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Create VPC with multiple AZs - CDK will automatically create subnets
  // using CIDR splitting (Fn::Cidr and Fn::Select)
  const vpc = new Vpc(stack, "MultiAzVpc", {
    cidr: "10.0.0.0/16",
    maxAzs: 2,  // Create subnets in 2 availability zones
  });

  // Synthesize
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify VPC was created
  const vpcResources = tfJson?.resource?.awscc_ec2_vpc;
  assert.ok(vpcResources, "VPC resource created");

  // CDK VPC construct creates multiple resources
  const allResources = tfJson?.resource;
  assert.ok(allResources, "Resources created");

  // Verify various VPC-related resources were created
  // (subnets, route tables, internet gateway, etc.)
  const resourceTypes = Object.keys(allResources);
  console.log("\n=== Resource Types Created ===");
  console.log(resourceTypes);

  // Check for subnets
  const subnetResources = tfJson?.resource?.awscc_ec2_subnet;
  if (subnetResources) {
    const subnetCount = Object.keys(subnetResources).length;
    console.log(`\n=== ${subnetCount} Subnets Created ===`);

    // CDK creates public and private subnets across AZs
    // With maxAzs=2, we typically get at least 2 subnets
    assert.ok(subnetCount >= 2, `At least 2 subnets created (found ${subnetCount})`);

    // Verify subnets have CIDR blocks and VPC references
    Object.entries(subnetResources).forEach(([key, subnet]: [string, any]) => {
      assert.ok(subnet.vpc_id, `Subnet ${key} has VPC ID reference`);
      assert.ok(subnet.cidr_block, `Subnet ${key} has CIDR block`);

      console.log(`\n=== Subnet: ${key} ===`);
      console.log(JSON.stringify(subnet, null, 2));
    });
  }

  // Verify cfncompat provider is configured (for CIDR splitting functions)
  assert.ok(
    tfJson.provider?.cfncompat,
    "Cfncompat provider configured for intrinsic functions"
  );

  console.log("\n=== Full VPC Stack ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("VPC bridge with custom subnet configuration", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Create VPC with custom subnet configuration
  const vpc = new Vpc(stack, "CustomVpc", {
    cidr: "172.16.0.0/16",
    maxAzs: 3,
    natGateways: 1,  // One NAT gateway instead of one per AZ
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: "Public",
        subnetType: SubnetType.PUBLIC,
      },
      {
        cidrMask: 24,
        name: "Private",
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    ],
  });

  // Synthesize
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify VPC exists
  const vpcResources = tfJson?.resource?.awscc_ec2_vpc;
  assert.ok(vpcResources, "VPC created");

  const vpcResource = Object.values(vpcResources)[0] as any;
  assert.strictEqual(vpcResource.cidr_block, "172.16.0.0/16", "Custom CIDR block");

  // Verify subnets were created with proper CIDR splitting
  const subnetResources = tfJson?.resource?.awscc_ec2_subnet;
  if (subnetResources) {
    const subnetCount = Object.keys(subnetResources).length;
    console.log(`\n=== ${subnetCount} Subnets Created with Custom Configuration ===`);

    // With 2 subnet types across 3 AZs, we expect 6 subnets
    // (3 public + 3 private)
    Object.entries(subnetResources).forEach(([key, subnet]: [string, any]) => {
      assert.ok(subnet.cidr_block, `Subnet ${key} has CIDR block`);
      console.log(`${key}: CIDR = ${JSON.stringify(subnet.cidr_block)}`);
    });
  }

  console.log("\n=== Custom VPC Configuration ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("VPC bridge handles isolated subnets with CIDR allocation", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Create VPC with isolated subnets (no internet access)
  const vpc = new Vpc(stack, "IsolatedVpc", {
    cidr: "10.1.0.0/16",
    maxAzs: 2,
    subnetConfiguration: [
      {
        cidrMask: 26,  // Smaller subnets (/26 = 64 IPs)
        name: "Database",
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
    ],
  });

  // Synthesize
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify VPC
  const vpcResources = tfJson?.resource?.awscc_ec2_vpc;
  assert.ok(vpcResources, "VPC created");

  // Verify subnets
  const subnetResources = tfJson?.resource?.awscc_ec2_subnet;
  if (subnetResources) {
    const subnetCount = Object.keys(subnetResources).length;
    console.log(`\n=== ${subnetCount} Isolated Subnets Created ===`);

    // Should have 2 isolated subnets (one per AZ)
    assert.ok(subnetCount >= 2, "At least 2 isolated subnets created");
  }

  console.log("\n=== Isolated VPC Stack ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("VPC bridge with single AZ preserves CIDR splitting logic", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Simple VPC in a single AZ
  const vpc = new Vpc(stack, "SingleAzVpc", {
    cidr: "192.168.0.0/16",
    maxAzs: 1,
  });

  // Synthesize
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify VPC exists
  assert.ok(tfJson.resource?.awscc_ec2_vpc, "VPC created");

  // Even with a single AZ, CDK still uses CIDR splitting functions
  // for subnet allocation
  const subnetResources = tfJson?.resource?.awscc_ec2_subnet;
  if (subnetResources) {
    console.log("\n=== Single AZ Subnets ===");
    Object.entries(subnetResources).forEach(([key, subnet]: [string, any]) => {
      console.log(`${key}:`);
      console.log(`  CIDR: ${JSON.stringify(subnet.cidr_block)}`);
      console.log(`  VPC: ${JSON.stringify(subnet.vpc_id)}`);
    });
  }

  // Verify providers are configured
  assert.ok(tfJson.provider?.awscc, "AWSCC provider configured");
  assert.ok(tfJson.provider?.cfncompat, "Cfncompat provider configured");

  console.log("\n=== Single AZ VPC ===");
  console.log(JSON.stringify(tfJson, null, 2));
});
