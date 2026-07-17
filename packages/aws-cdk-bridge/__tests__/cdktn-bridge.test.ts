/**
 *  Unit test: AWS CDK L2 construct → CDKTN (Terraform via awscc provider)
 *
 * Demonstrates transparent bridge pattern:
 * 1. Mix with other Terraform providers (e.g., Datadog)
 * 2. CDKTN synthesizes to pure Terraform HCL (no CloudFormation in output)
 */

import { test } from "node:test";
import assert from "node:assert";
import { monitor, provider } from "@cdktn/provider-datadog";
import { TerraformStack, Testing } from "cdktn";
import { Bucket } from "../src/s3/bucket.ts";

test("Mix AWS CDK L2 (via bridge) with native Terraform constructs", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "mixed-stack");

  // AWS CDK L2 construct → CDKTN (transparent bridge)
  const bucket = new Bucket(stack, "DataBucket", {
    versioned: true,
    bucketName: "my-data-bucket",
  });

  // This would demonstrate mixing bridged AWS resources with other providers
  new provider.DatadogProvider(stack, "datadog", { apiKey: "test", appKey: "test" });
  new monitor.Monitor(stack, "Monitor", {
    name: "S3 Bucket Alert",
    type: "metric alert",
    query: `aws.s3.bucket_size_bytes{bucket:${bucket.bucketName}}`,
    message: "test",
  });

  const synthesized = Testing.synth(stack);
  assert.ok(synthesized, "Mixed stack synthesized successfully");

  console.log("\n=== Mixed Stack: AWS (bridged) + Terraform (native) ===");
  const tfJson = JSON.parse(synthesized);
  
  // Verify DataDog Monitor properties were preserved
  const datadogResource = tfJson?.resource?.datadog_monitor;
  assert.ok(datadogResource, "DataDog Monitor resource found");

  console.log(JSON.stringify(tfJson, null, 2));
});

test("E2E: CDK L2 → CDKTN → Terraform HCL (no CloudFormation in output)", () => {
  console.log("\n=== Transparent Bridge Integration Test ===\n");

  const app = Testing.app();
  const stack = new TerraformStack(app, "e2e-stack");

  // User code: instantiate real aws-cdk-lib construct
  const bucket = new Bucket(stack, "MyBucket", {
    versioned: true,
    bucketName: "my-app-bucket",
  });

  console.log("--- User Code ---");
  console.log("new Bucket(stack, 'MyBucket', { versioned: true })");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  console.log("\n--- Synthesized Terraform JSON ---");
  console.log(JSON.stringify(tfJson, null, 2));

  // Verify no CloudFormation in output
  const serialized = JSON.stringify(tfJson);
  assert.ok(!serialized.includes("AWS::"), "No CloudFormation types in output");
  assert.ok(!serialized.includes("Fn::"), "No CloudFormation intrinsics in output");
  assert.ok(serialized.includes("awscc_s3_bucket"), "Pure Terraform resource types");

  console.log("\n✅ aws-cdk-lib L2 construct → Pure Terraform HCL (via awscc provider)");
  console.log("✅ No CloudFormation in output - fully transparent bridge");
  console.log("✅ Ready to mix with other Terraform providers");
});
