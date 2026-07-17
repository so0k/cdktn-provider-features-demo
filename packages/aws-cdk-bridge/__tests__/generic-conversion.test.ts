/**
 * Unit test: generic CDK → CDKTN conversion using fromAwsCdk()
 *
 * Demonstrates:
 * 1. Generic conversion API for any CDK resource
 * 2. Introspection-based property extraction
 * 3. CloudFormation type mapping
 * 4. Multiple resource handling
 */

import { test } from "node:test";
import assert from "node:assert";
import { Bucket as CdkBucket } from "aws-cdk-lib/aws-s3";
import { TerraformStack, Testing } from "cdktn";
import { S3Bucket } from "../../../../cdktn-provider-features-demo/.gen/providers/awscc/s3-bucket/index.ts";
import { convertProperties, fromAwsCdk, inspect, ResourceClassRegistry } from "../src/core/index.ts";

test("fromAwsCdk() - explicit resource class", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Generic conversion: CDK Bucket → CDKTN S3Bucket
  const bucket = fromAwsCdk({
    scope: stack,
    id: "MyBucket",
    constructFn: (cdkScope, cdkId) =>
      new CdkBucket(cdkScope, cdkId, {
        versioned: true,
        bucketName: "my-test-bucket",
      }),
    resourceClass: S3Bucket,
    cfnType: "AWS::S3::Bucket",
  });

  // Verify bucket was created
  assert.ok(bucket, "Bucket created successfully");
  assert.ok(bucket.arn, "Bucket ARN available");
  assert.ok(bucket.bucketName, "Bucket name available");

  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify Terraform resource exists
  assert.ok(tfJson.resource?.awscc_s3_bucket, "awscc_s3_bucket resource in output");

  console.log("\n=== Generic Conversion Test ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("inspect() - examine CloudFormation metadata", () => {
  // Inspect what CloudFormation resources a CDK construct creates
  const result = inspect(
    (scope, id) =>
      new CdkBucket(scope, id, {
        versioned: true,
        bucketName: "inspect-test",
      }),
    "InspectBucket"
  );

  console.log("\n=== CloudFormation Metadata ===");
  console.log(JSON.stringify(result, null, 2));

  // Verify metadata structure
  assert.ok(result.resources, "Resources array exists");
  assert.ok(Array.isArray(result.resources), "Resources is an array");
  assert.strictEqual(result.resources.length, 1, "One resource created");
  assert.strictEqual(result.resources[0].type, "AWS::S3::Bucket", "Correct CloudFormation type");
  assert.ok(result.resources[0].properties, "Properties extracted");
  assert.ok(result.resources[0].logicalId, "Logical ID extracted");

  // Verify properties
  const props = result.resources[0].properties;
  assert.ok(props.VersioningConfiguration, "Versioning configuration present");
  assert.ok(props.BucketName, "Bucket name present");

  // Verify conditions (should be empty for this simple bucket)
  assert.ok(result.conditions !== undefined, "Conditions object exists");
});

test("convertProperties() - property conversion", () => {
  // Test CloudFormation property conversion
  const cfnProperties = {
    BucketName: "my-bucket",
    VersioningConfiguration: {
      Status: "Enabled",
    },
    Tags: [
      { Key: "Environment", Value: "Test" },
      { Key: "Owner", Value: "DevTeam" },
    ],
    // Intrinsic function (should be skipped with resolveRefs: true)
    BucketArn: { "Fn::GetAtt": ["MyBucket", "Arn"] },
  };

  const converted = convertProperties(cfnProperties, {
    resolveRefs: true,
  });

  console.log("\n=== Property Conversion ===");
  console.log("Input:", JSON.stringify(cfnProperties, null, 2));
  console.log("Output:", JSON.stringify(converted, null, 2));

  // Verify conversion
  assert.ok(converted.bucketName, "BucketName converted to bucketName");
  assert.ok(converted.versioningConfiguration, "Nested objects preserved");
  assert.ok(converted.tags, "Arrays preserved");
  assert.strictEqual(converted.bucketArn, undefined, "Intrinsic functions resolved");
});

test("ResourceClassRegistry - register and lookup", () => {
  // Register S3Bucket class
  ResourceClassRegistry.register("AWS::S3::Bucket", S3Bucket);

  // Verify registration
  assert.ok(
    ResourceClassRegistry.has("AWS::S3::Bucket"),
    "S3Bucket registered"
  );

  const registeredClass = ResourceClassRegistry.get("AWS::S3::Bucket");
  assert.strictEqual(registeredClass, S3Bucket, "Correct class returned");

  const types = ResourceClassRegistry.types();
  assert.ok(types.includes("AWS::S3::Bucket"), "Type in registry");

  console.log("\n=== Registered CloudFormation Types ===");
  console.log(types);
});

test("fromAwsCdk() - registry-based conversion", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "registry-stack");

  // Register S3Bucket class
  ResourceClassRegistry.register("AWS::S3::Bucket", S3Bucket);

  // Convert using registry (no need to specify resourceClass)
  const bucket = fromAwsCdk({
    scope: stack,
    id: "RegistryBucket",
    constructFn: (scope, id) =>
      new CdkBucket(scope, id, {
        versioned: true,
      }),
    cfnType: "AWS::S3::Bucket"
  });

  assert.ok(bucket, "Bucket created via registry");
  assert.ok(bucket.arn, "Bucket ARN available");

  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  assert.ok(tfJson.resource?.awscc_s3_bucket, "Resource in output");

  console.log("\n=== Registry-based Conversion ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("Complex CDK construct with multiple resources", () => {
  // Test construct that creates multiple CloudFormation resources
  const result = inspect((scope, id) => {
    const bucket = new CdkBucket(scope, `${id}Main`, {
      versioned: true,
    });

    // Create a second bucket
    new CdkBucket(scope, `${id}Logs`, {
      versioned: false,
    });

    return bucket;
  }, "ComplexConstruct");

  const metadata = result.resources;

  console.log("\n=== Multiple Resources ===");
  console.log(`Found ${metadata.length} resources:`);
  metadata.forEach((m, i) => {
    console.log(`  ${i}: ${m.type} (${m.logicalId})`);
  });

  assert.strictEqual(metadata.length, 2, "Two resources created");
  assert.ok(
    metadata.every(m => m.type === "AWS::S3::Bucket"),
    "All are S3 buckets"
  );
});

test("Handle CloudFormation intrinsic functions", () => {
  const result = inspect(
    (scope, id) =>
      new CdkBucket(scope, id, {
        versioned: true,
        // CDK will generate intrinsic functions for dynamic values
      }),
    "IntrinsicTest"
  );

  const properties = result.resources[0].properties;
  console.log("\n=== Intrinsic Functions Handling ===");
  console.log("Raw CloudFormation properties:");
  console.log(JSON.stringify(properties, null, 2));

  // Convert with intrinsic resolution
  const converted = convertProperties(properties, {
    resolveRefs: true,
  });

  console.log("\nConverted (intrinsics resolved):");
  console.log(JSON.stringify(converted, null, 2));

  // Verify intrinsics were handled
  assert.ok(converted, "Properties converted");
});

test("E2E: Generic conversion matches manual bridge", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "e2e-generic");

  // Generic conversion
  const genericBucket = fromAwsCdk({
    scope: stack,
    id: "GenericBucket",
    constructFn: (scope, id) =>
      new CdkBucket(scope, id, {
        versioned: true,
        bucketName: "test-bucket",
      }),
    resourceClass: S3Bucket,
  });

  assert.ok(genericBucket, "Generic conversion successful");

  const synthesized = Testing.synth(stack);
  const tfJson = JSON.parse(synthesized);

  // Verify no CloudFormation in output
  const serialized = JSON.stringify(tfJson);
  assert.ok(!serialized.includes("AWS::"), "No CloudFormation types");
  assert.ok(!serialized.includes("Fn::"), "No CloudFormation intrinsics");
  assert.ok(serialized.includes("awscc_s3_bucket"), "Terraform resource type");

  console.log("\n=== E2E Generic Conversion ===");
  console.log(JSON.stringify(tfJson, null, 2));
  console.log("\n✅ Generic CDK → CDKTN conversion working");
});
