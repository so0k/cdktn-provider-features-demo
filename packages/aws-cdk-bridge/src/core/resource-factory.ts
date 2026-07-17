/**
 * Generic CDK CfnResource → CDKTN TerraformResource factory
 *
 * Uses introspection to automatically convert any CDK L1/L2 construct to
 * a corresponding CDKTN resource via the awscc provider.
 *
 * Pattern:
 * 1. Synthesize CDK construct to CloudFormation (isolated scope)
 * 2. Extract CFN resource type and properties via introspection
 * 3. Map CFN type to corresponding CDKTN resource class
 * 4. Create CDKTN resource with converted properties
 */

import { inspect } from "node:util";
import type { Construct } from "constructs";
import { Stack } from "aws-cdk-lib";
import { CfnExpressionResolver, type ResolutionStrategy } from "./expression-resolver.ts";

/**
 * Metadata extracted from a CloudFormation resource
 */
export interface CfnResourceMetadata {
  /** CloudFormation resource type (e.g., "AWS::S3::Bucket") */
  type: string;
  /** CloudFormation properties */
  properties: Record<string, any>;
  /** Resource logical ID in the template */
  logicalId: string;
  /** Additional attributes (DependsOn, Condition, etc.) */
  attributes?: Record<string, any>;
}

/**
 * Context for resource conversion
 */
export interface ConversionContext {
  /** CDKTN scope where resource will be created */
  scope: Construct;
  /** Construct ID for the CDKTN resource */
  id: string;
  /** CloudFormation metadata */
  cfnMetadata: CfnResourceMetadata;
  /** Strategy for handling CloudFormation intrinsic functions */
  resolutionStrategy?: ResolutionStrategy;
  /** CloudFormation conditions from the template */
  conditions?: Record<string, any>;
  /** CloudFormation resource type (for xxxToTerraform mapper lookup) */
  resourceType?: string;
}

/**
 * Result of CloudFormation template extraction
 */
export interface CfnTemplateMetadata {
  resources: CfnResourceMetadata[];
  conditions: Record<string, any>;
}

class AwsCdkStack extends Stack {
  toMedadata(): CfnTemplateMetadata {
    const cfnTemplate = this._toCloudFormation();
    console.debug("[Stack][toMedadata] cfnTemplate", inspect(cfnTemplate, {
      depth: null, colors: true
    }));

    // Extract all resources
    const resources = cfnTemplate.Resources || {};
    const metadata: CfnResourceMetadata[] = [];

    for (const [logicalId, resource] of Object.entries(resources)) {
      const cfnResource = resource as any;

      metadata.push({
        type: cfnResource.Type,
        properties: cfnResource.Properties || {},
        logicalId,
        attributes: {
          ...(cfnResource.DependsOn && { DependsOn: cfnResource.DependsOn }),
          ...(cfnResource.Condition && { Condition: cfnResource.Condition }),
          ...(cfnResource.Metadata && { Metadata: cfnResource.Metadata }),
        },
      });
    }

    // Extract conditions
    const conditions = cfnTemplate.Conditions || {};

    return {
      resources: metadata,
      conditions,
    };
  }
}

/**
 * Factory for creating CDKTN resources from CDK constructs
 */
export class TerraformResourceFactory {
  /**
   * Extract CloudFormation metadata from a CDK construct
   *
   * @param constructFn Function that instantiates the CDK construct
   * @param constructId ID for the construct (used for extraction only)
   * @returns CloudFormation template metadata (resources + conditions)
   */
  static extractCfnMetadata(
    constructFn: (scope: Construct, id: string) => void,
    constructId: string = "Resource"
  ): CfnTemplateMetadata {
    // Create isolated CDK scope
    const stack = new AwsCdkStack();

    // Instantiate construct
    constructFn(stack, constructId);

    return stack.toMedadata();
  }

  /**
   * Convert CloudFormation properties to CDKTN-compatible format
   *
   * Handles:
   * - CloudFormation intrinsic functions (Ref, Fn::GetAtt, etc.)
   * - Nested objects and arrays
   * - Type conversions
   */
  static convertProperties(
    properties: Record<string, any>,
    context?: {
      resolveRefs?: boolean;
      resolutionStrategy?: ResolutionStrategy;
      resourceTypeMap?: Map<string, string>;
      scope?: Construct;
      conditions?: Record<string, any>;
      resourceType?: string;
    }
  ): Record<string, any> {
    const converted: Record<string, any> = {};

    // Determine resolution strategy
    const strategy: ResolutionStrategy = context?.resolutionStrategy ??
      (context?.resolveRefs ? "skip" : "preserve");

    // Use expression resolver for intrinsic functions
    const resolver = new CfnExpressionResolver({
      strategy,
      recursive: true,
      resourceTypeMap: context?.resourceTypeMap,
      scope: context?.scope,
      conditions: context?.conditions,
      resourceType: context?.resourceType,
    });

    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined || value === null) {
        continue;
      }

      // Resolve intrinsic functions
      const resolvedValue = resolver.resolve(value, [key]);

      if (resolvedValue !== undefined) {
        // Convert CloudFormation property name to camelCase if needed
        const tfKey = this.cfnPropertyToTerraform(key);
        converted[tfKey] = resolvedValue;
      }
    }

    return converted;
  }

  /**
   * Convert CloudFormation property name to Terraform convention
   *
   * CloudFormation uses PascalCase, Terraform typically uses snake_case
   * But awscc provider accepts CloudFormation schema as-is
   */
  private static cfnPropertyToTerraform(cfnProperty: string): string {
    // awscc provider accepts CloudFormation property names directly
    // but converts them to camelCase
    return cfnProperty.charAt(0).toLowerCase() + cfnProperty.slice(1);
  }

  /**
   * Map CloudFormation resource type to CDKTN resource class name
   *
   * AWS::S3::Bucket → S3Bucket
   * AWS::Lambda::Function → LambdaFunction
   */
  static cfnTypeToTerraformClass(cfnType: string): string {
    const parts = cfnType.split("::");
    if (parts.length !== 3 || parts[0] !== "AWS") {
      throw new Error(`Unsupported CloudFormation type: ${cfnType}`);
    }

    const [, service, resource] = parts;
    return `${service}${resource}`;
  }

  /**
   * Map CloudFormation resource type to awscc provider resource type
   *
   * AWS::S3::Bucket → awscc_s3_bucket
   */
  static cfnTypeToAwsccType(cfnType: string): string {
    const parts = cfnType.split("::");
    if (parts.length !== 3 || parts[0] !== "AWS") {
      throw new Error(`Unsupported CloudFormation type: ${cfnType}`);
    }

    const [, service, resource] = parts;
    return `awscc_${service.toLowerCase()}_${this.toSnakeCase(resource)}`;
  }

  /**
   * Convert PascalCase to snake_case
   */
  private static toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, "_$1")
      .toLowerCase()
      .replace(/^_/, "");
  }

  /**
   * Create a CDKTN resource from CloudFormation metadata
   *
   * This is a low-level method - typically you'd use the high-level
   * fromAwsCdk() instead.
   *
   * @param context Conversion context
   * @param resourceClass CDKTN resource class constructor
   * @returns Instantiated CDKTN resource
   */
  static createTerraformResource<T = any>(
    context: ConversionContext,
    resourceClass: new (scope: any, id: string, config?: any) => T,
    resourceTypeMap?: Map<string, string>
  ): T {
    const { scope, id, cfnMetadata, resolutionStrategy, conditions, resourceType } = context;

    // Convert CloudFormation properties
    const tfConfig = this.convertProperties(cfnMetadata.properties, {
      resolutionStrategy: resolutionStrategy || "skip",
      resourceTypeMap,
      scope,
      conditions,
      resourceType,
    });

    // Create CDKTN resource
    return new resourceClass(scope, id, tfConfig);
  }
}

/**
 * Registry for CloudFormation type → CDKTN resource class mappings
 */
export class ResourceClassRegistry {
  private static registry = new Map<string, new (scope: any, id: string, config?: any) => any>();

  /**
   * Register a CDKTN resource class for a CloudFormation type
   */
  static register(
    cfnType: string,
    resourceClass: new (scope: any, id: string, config?: any) => any
  ): void {
    this.registry.set(cfnType, resourceClass);
  }

  /**
   * Get registered CDKTN resource class for a CloudFormation type
   */
  static get(cfnType: string): (new (scope: any, id: string, config?: any) => any) | undefined {
    return this.registry.get(cfnType);
  }

  /**
   * Check if a CloudFormation type has a registered CDKTN resource class
   */
  static has(cfnType: string): boolean {
    return this.registry.has(cfnType);
  }

  /**
   * Get all registered CloudFormation types
   */
  static types(): string[] {
    return Array.from(this.registry.keys());
  }
}
