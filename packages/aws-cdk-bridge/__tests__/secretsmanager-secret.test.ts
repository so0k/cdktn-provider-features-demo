/**
 *  Unit test: AWS CDK L2 construct → CDKTN (Terraform via awscc provider)
 *
 * Demonstrates transparent bridge pattern:
 * 1. User instantiates real aws-cdk-lib L2 construct (Secret)
 */

import { test } from "node:test";
import assert from "node:assert";
import { Secret as CdkSecret } from "aws-cdk-lib/aws-secretsmanager";
import { TerraformStack, Testing } from "cdktn";
import { SecretsmanagerSecret } from "../../../.gen/providers/awscc/secretsmanager-secret/index.ts";
import { fromAwsCdk, ResourceClassRegistry } from "../src/core/index.ts";
import { Secret } from "../src/secretsmanager/secret.ts";

test("AWS CDK L2 Secret bridges transparently to CDKTN", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Configure awscc provider

  // Use real aws-cdk-lib API, synthesizes to Terraform!
  const secret = new Secret(stack, "MySecret", {
    versioned: true,
  });

  // Verify bucket was created in CDKTN tree
  assert.ok(secret.secretName, "Secret name is available");
  assert.ok(secret.secretId, "Secret ID is available");

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);

  // Verify Terraform resource was created
  assert.ok(synthesized, "CDKTN synthesized successfully");

  // Parse synthesized Terraform JSON
  const tfJson = JSON.parse(synthesized);

  // Verify awscc_secretsmanager_secret resource exists
  const resources = tfJson?.resource?.awscc_secretsmanager_secret;
  assert.ok(resources, "awscc_secretsmanager_secret resource found in Terraform output");

  console.log("\n=== Synthesized Terraform (via awscc provider) ===");
  console.log(JSON.stringify(tfJson, null, 2));
});

test("AWS CDK L2 Secret owned-secret name recovery is exercised", () => {
  const app = Testing.app();
  const stack = new TerraformStack(app, "test-stack");

  // Register CloudFormation type → CDKTN resource class mapping
  ResourceClassRegistry.register("AWS::SecretsManager::Secret", SecretsmanagerSecret);

  // Configure awscc provider

  // Demonstrate aws-cdk-bridge with multiple resources:
  // Create two secrets where the second references the first's secretName.
  // This mimics an L2 construct that creates nested resources internally.
  // The bridge creates ALL resources as siblings, and returns the primary one.

  const secret1 = fromAwsCdk<SecretsmanagerSecret>({
    scope: stack,
    id: "Secrets",
    constructFn: (cdkScope, cdkId) => {
      // Create secret1 first (without explicit name - triggers intrinsic generation)
      const s1 = new CdkSecret(cdkScope, "Secret1", {
        generateSecretString: {},
      });

      // Create secret2 that references secret1's name in description
      // This causes CDK to synthesize secretName intrinsics into the CFN template
      new CdkSecret(cdkScope, "Secret2", {
        description: `Refs: ${s1.secretName}`,
        generateSecretString: {},
      });
    },
    resourceClass: SecretsmanagerSecret,
    resolutionStrategy: "cfncompat", // Convert CFN intrinsics to cfncompat provider functions
  });

  // Synthesize to Terraform
  const synthesized = Testing.synth(stack);

  // Verify Terraform resource was created
  assert.ok(synthesized, "CDKTN synthesized successfully");

  // Parse synthesized Terraform JSON
  const tfJson = JSON.parse(synthesized);

  // Verify awscc_secretsmanager_secret resource exists
  const resources = tfJson?.resource?.awscc_secretsmanager_secret;
  assert.ok(resources, "awscc_secretsmanager_secret resource found in Terraform output");

  // Verify both secrets were created
  const resourceKeys = Object.keys(resources);
  assert.strictEqual(resourceKeys.length, 2, "Two secrets should be created");

  // Find Secret1 and Secret2 (CDK generates logical IDs with hashes)
  const secret1Key = resourceKeys.find(k => k.startsWith("Secret1"));
  const secret2Key = resourceKeys.find(k => k.startsWith("Secret2"));

  assert.ok(secret1Key, "Secret1 resource exists");
  assert.ok(secret2Key, "Secret2 resource exists");

  // Secret1 should NOT have a description
  assert.strictEqual(resources[secret1Key].description, undefined, "Secret1 should not have a description");

  // Secret2 SHOULD have a description with cfncompat intrinsics
  const secret2Description = resources[secret2Key].description;
  assert.ok(secret2Description, "Secret2 should have a description");

  // Verify the description contains cfncompat provider functions
  assert.ok(secret2Description.includes("provider::cfncompat::join"), "Description should contain cfncompat::join");
  assert.ok(secret2Description.includes("provider::cfncompat::select"), "Description should contain cfncompat::select");
  assert.ok(secret2Description.includes("provider::cfncompat::split"), "Description should contain cfncompat::split");

  // Verify the description references Secret1
  assert.ok(secret2Description.includes(`awscc_secretsmanager_secret.${secret1Key}.id`),
    "Description should reference Secret1's ID");

  // Verify it starts with "Refs: " prefix
  assert.ok(secret2Description.includes("Refs: "), "Description should start with 'Refs: ' prefix");

  console.log("\n=== Synthesized Terraform (via awscc provider) ===");
  console.log(JSON.stringify(tfJson, null, 2));
});
