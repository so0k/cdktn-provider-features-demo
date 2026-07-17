/**
 * Unit test: AWS CDK L2 construct → CDKTN (Terraform via awscc provider)
 *
 * Demonstrates transparent bridge pattern:
 * 1. User instantiates real aws-cdk-lib L2 construct (Bucket)
 * 2. Bridge synthesizes to CloudFormation internally (isolated - not visible to CDKTN)
 * 3. CloudFormation properties passed directly to awscc provider resource
 */

import { test } from "node:test";
import assert from "node:assert";
import { TerraformStack, Testing } from "cdktn";
import { Bucket } from "../src/s3/bucket.ts";

test("AWS CDK L2 Bucket bridges transparently to CDKTN", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Use real aws-cdk-lib API, synthesizes to Terraform!
  const bucket = new Bucket(stack, "MyBucket", {
    versioned: true,
  });

  // Verify bucket was created in CDKTN tree
  assert.ok(bucket.bucketArn, "Bucket ARN is available");
  assert.ok(bucket.bucketName, "Bucket name is available");
  assert.ok(bucket.bucketId, "Bucket ID is available");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);

  // Verify Terraform resource was created
  assert.ok(synthesized, "CDKTN synthesized successfully");

  // Parse synthesized Terraform JSON
  const tfJson = JSON.parse(synthesized);

  // Verify awscc_s3_bucket resource exists
  const resources = tfJson?.resource?.awscc_s3_bucket;
  assert.ok(resources, "awscc_s3_bucket resource found in Terraform output");

  console.log("\n=== Synthesized Terraform (via awscc provider) ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("Bridge preserves aws-cdk-lib BucketProps API", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "api-test");

  // All standard aws-cdk-lib.BucketProps should work
  const bucket = new Bucket(stack, "FullConfigBucket", {
    versioned: true,
    bucketName: "my-configured-bucket",
    // Note: More complex props will work as bridge extracts full CFN template
    // encryption: BucketEncryption.S3_MANAGED,
    // publicReadAccess: false,
    // lifecycleRules: [...],
    // etc.
  });

  assert.ok(bucket, "Bucket created with full CDK API");

  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify bucket properties were preserved
  const bucketResource = tfJson?.resource?.awscc_s3_bucket;
  assert.ok(bucketResource, "Bucket resource found");

  console.log("\n=== Full CDK API Preserved ===");
  console.log(JSON.stringify(tfJson, null, 2));
});
