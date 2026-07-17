/**
 * Generic TerraformResource wrapper with automatic CDK → CDKTN conversion
 *
 * Usage:
 *   const bucket = fromAwsCdk(
 *     scope,
 *     "MyBucket",
 *     () => new cdk.Bucket(stack, "Bucket", { versioned: true }),
 *     S3Bucket  // CDKTN resource class
 *   );
 *
 * The factory:
 * 1. Synthesizes CDK construct to CloudFormation (isolated)
 * 2. Extracts CFN resource properties via introspection
 * 3. Converts to CDKTN resource configuration
 * 4. Creates CDKTN resource with converted config
 */

import type { Construct } from "constructs";
import {
  TerraformResourceFactory,
  ResourceClassRegistry,
  type CfnResourceMetadata,
} from "./resource-factory.ts";
import type { ResolutionStrategy } from "./expression-resolver.ts";

/**
 * Options for fromAwsCdk()
 */
export interface FromOptions<T = any> {
  /** CDKTN scope where resource will be created */
  scope: Construct;
  /** Construct ID for the CDKTN resource */
  id: string;
  /** Function that instantiates the CDK construct (in isolated scope) */
  constructFn: (scope: Construct, id: string) => void;
  /** CDKTN resource class to instantiate */
  resourceClass?: new (scope: any, id: string, config?: any) => T;
  /** Optionally override the CloudFormation type to look for */
  cfnType?: string;
  /** Index of resource if multiple resources are created (default: 0) */
  resourceIndex?: number;
  /** Strategy for handling CloudFormation intrinsic functions (default: "skip") */
  resolutionStrategy?: ResolutionStrategy;
}

/**
 * Create a CDKTN resource from a CDK construct
 *
 * This method uses introspection to automatically convert any CDK L1/L2
 * construct to the corresponding CDKTN resource. If the CDK construct creates
 * multiple CloudFormation resources (nested resources), all are created as
 * siblings in the CDKTN scope, and the primary resource is returned.
 *
 * @example
 * ```typescript
 * import { Bucket as CdkBucket } from "aws-cdk-lib/aws-s3";
 * import { S3Bucket } from ".gen/providers/awscc/s3-bucket";
 *
 * const bucket = fromAwsCdk({
 *   scope: stack,
 *   id: "MyBucket",
 *   constructFn: (scope, id) => new CdkBucket(scope, id, { versioned: true }),
 *   resourceClass: S3Bucket,
 * });
 * ```
 *
 * @example Multiple resources (L2 construct with nested resources)
 * ```typescript
 * const secret = fromAwsCdk({
 *   scope: stack,
 *   id: "Secrets",
 *   constructFn: (scope, id) => {
 *     const s1 = new Secret(scope, "Secret1", {});
 *     new Secret(scope, "Secret2", { description: s1.secretName });
 *   },
 *   resourceIndex: 0, // Returns Secret1, but Secret2 is also created
 * });
 * ```
 */
export const fromAwsCdk = <T = any>(options: FromOptions<T>): T => {
  const {
    scope,
    id,
    constructFn,
    resourceClass,
    cfnType,
    resourceIndex = 0,
    resolutionStrategy = "skip",
  } = options;

  // Extract ALL CloudFormation resources by synthesizing CDK construct
  const templateMetadata = TerraformResourceFactory.extractCfnMetadata(
    constructFn,
    id
  );

  const { resources: metadata, conditions } = templateMetadata;

  if (metadata.length === 0) {
    throw new Error(
      `No CloudFormation resources found when synthesizing construct "${id}"`
    );
  }

  // Build resource type map for resolving Refs across all resources
  const resourceTypeMap = new Map<string, string>();
  for (const meta of metadata) {
    resourceTypeMap.set(meta.logicalId, meta.type);
  }

  // Find the target/primary resource
  let targetMetadata: CfnResourceMetadata;
  let targetIndex: number;

  if (cfnType) {
    // Look for specific CloudFormation type
    const foundIndex = metadata.findIndex(m => m.type === cfnType);
    if (foundIndex === -1) {
      throw new Error(
        `CloudFormation resource type "${cfnType}" not found. ` +
        `Available types: ${metadata.map(m => m.type).join(", ")}`
      );
    }
    targetIndex = foundIndex;
    targetMetadata = metadata[foundIndex];
  } else {
    // Use resourceIndex
    if (resourceIndex >= metadata.length) {
      throw new Error(
        `Resource index ${resourceIndex} out of bounds. ` +
        `Found ${metadata.length} resource(s): ${metadata.map(m => m.type).join(", ")}`
      );
    }
    targetIndex = resourceIndex;
    targetMetadata = metadata[resourceIndex];
  }

  // Create ALL resources in the scope (to maintain relationships)
  let primaryResource: T | null = null;

  for (let i = 0; i < metadata.length; i++) {
    const meta = metadata[i];

    // Look up resource class in registry or use provided one for target
    const toClass = (i === targetIndex && resourceClass)
      ? resourceClass
      : ResourceClassRegistry.get(meta.type);

    if (!toClass) {
      console.warn(
        `No CDKTN resource class registered for CloudFormation type "${meta.type}", skipping`
      );
      continue;
    }

    const resource = TerraformResourceFactory.createTerraformResource<T>(
      {
        scope,
        id: meta.logicalId,
        cfnMetadata: meta,
        resolutionStrategy,
        conditions, // Pass conditions for Fn::If resolution
        resourceType: meta.type, // Pass resource type for xxxToTerraform mapper lookup
      },
      toClass,
      resourceTypeMap
    );

    // Track the primary resource
    if (i === targetIndex) {
      primaryResource = resource;
    }
  }

  if (!primaryResource) {
    throw new Error(
      `Failed to create primary resource for CloudFormation type "${targetMetadata.type}"`
    );
  }

  return primaryResource;
};

/**
 * Extract CloudFormation metadata from a CDK construct without creating CDKTN resource
 *
 * Useful for debugging or custom conversion logic.
 */
export const inspect = (
  constructFn: (scope: Construct, id: string) => void,
  constructId: string = "Resource"
) => {
  return TerraformResourceFactory.extractCfnMetadata(constructFn, constructId);
};

/**
 * Convert CloudFormation properties to Terraform format
 *
 * Useful for custom conversion scenarios.
 */
export const convertProperties = (
  properties: Record<string, any>,
  options?: { resolveRefs?: boolean }
): Record<string, any> => {
  return TerraformResourceFactory.convertProperties(properties, options);
};

/**
 * Re-export registry for convenience
 */
export { ResourceClassRegistry };
