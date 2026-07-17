/**
 * Expression resolver for CloudFormation intrinsic functions
 *
 * Handles conversion of CloudFormation intrinsic functions to Terraform-compatible formats.
 *
 * NOTE: The "cfncompat" resolution strategy requires:
 * 1. The cfncompat provider to be configured in your CDKTN stack
 * 2. The AWS provider to be configured (for DataAwsRegion data source)
 * 3. Generated bindings in .gen/providers/cfncompat/ and .gen/providers/aws/
 *
 * If these are not available, the resolver will automatically fall back to "skip" strategy.
 */

import { DataAwsRegion } from "../../../../.gen/providers/aws/data-aws-region/index.ts";
import { CfncompatProviderFunctions } from "../../../../.gen/providers/cfncompat/provider-functions/index.ts";

/**
 * CloudFormation intrinsic function representation
 */
export type CfnIntrinsic =
  | { Ref: string }
  | { "Fn::GetAtt": [string, string] | string }
  | { "Fn::Sub": string | [string, Record<string, any>] }
  | { "Fn::Join": [string, any[]] }
  | { "Fn::Split": [string, string] }
  | { "Fn::Select": [number, any[]] }
  | { "Fn::Base64": any }
  | { "Fn::Cidr": [string, number, number] }
  | { "Fn::FindInMap": [string, string, string] }
  | { "Fn::GetAZs": string | "" }
  | { "Fn::ImportValue": string }
  | { "Fn::If": [string, any, any] }
  | { "Fn::Not": [any] }
  | { "Fn::Equals": [any, any] }
  | { "Fn::And": any[] }
  | { "Fn::Or": any[] }
  | { "Fn::Contains": [any[], any] }
  | { [key: string]: any };

/**
 * Resolution strategy for intrinsic functions
 */
export type ResolutionStrategy =
  | "cfncompat"  // Convert to cfncompat provider functions
  | "skip"       // Skip intrinsics (remove from output)
  | "preserve"   // Keep as-is
  | "error";     // Throw error on intrinsics

/**
 * Options for expression resolution
 */
export interface ResolverOptions {
  /** Strategy for handling intrinsic functions */
  strategy?: ResolutionStrategy;
  /** Whether to recursively process nested values */
  recursive?: boolean;
  /** Map of CloudFormation logical IDs to their resource types (for resolving Refs) */
  resourceTypeMap?: Map<string, string>;
  /** CDKTN scope for creating helper resources (e.g., DataAwsRegion) - required for cfncompat strategy */
  scope?: any;
  /** CloudFormation conditions from the template */
  conditions?: Record<string, any>;
  /** CloudFormation type of the resource being converted (for applying xxxToTerraform mappers) */
  resourceType?: string;
  /** Property path for the current value (for finding the right mapper) */
  propertyPath?: string[];
}

/**
 * CloudFormation expression resolver
 *
 * Resolves CloudFormation intrinsic functions according to the specified strategy.
 */
export class CfnExpressionResolver {
  private readonly strategy: ResolutionStrategy;
  private readonly recursive: boolean;
  private readonly resourceTypeMap: Map<string, string>;
  private readonly scope?: any;
  private readonly conditions: Record<string, any>;
  private readonly resourceType?: string;
  private readonly propertyPath: string[];
  private regionDataSource?: any;
  private cfncompatFunctions?: any;

  constructor(options: ResolverOptions = {}) {
    this.strategy = options.strategy ?? "skip";
    this.recursive = options.recursive ?? true;
    this.resourceTypeMap = options.resourceTypeMap ?? new Map();
    this.scope = options.scope;
    this.conditions = options.conditions ?? {};
    this.resourceType = options.resourceType;
    this.propertyPath = options.propertyPath ?? [];
  }

  /**
   * Get or create the AWS region data source
   */
  private getRegionDataSource(): any {
    if (!this.scope) {
      throw new Error("Scope is required for cfncompat strategy with AWS::Region references");
    }

    if (!this.regionDataSource) {
      this.regionDataSource = new DataAwsRegion(this.scope, "bridge_current_region", {});
    }

    return this.regionDataSource;
  }

  /**
   * Get the appropriate xxxToTerraform mapper for a nested object property
   */
  private getToTerraformMapper(propertyName: string): ((value: any) => any) | null {
    if (!this.resourceType || !this.scope) {
      return null;
    }

    try {
      // Convert AWS::Kinesis::Stream + StreamEncryption -> kinesisStreamStreamEncryptionToTerraform
      const parts = this.resourceType.split("::");
      if (parts.length !== 3 || parts[0] !== "AWS") {
        return null;
      }

      const [, service, resource] = parts;
      const serviceLower = service.toLowerCase();
      const resourceCamel = resource.charAt(0).toLowerCase() + resource.slice(1);
      const propertyCamel = propertyName.charAt(0).toUpperCase() + propertyName.slice(1);

      // Build mapper function name: kinesisStreamStreamEncryptionToTerraform
      const mapperName = `${serviceLower}${resource}${propertyCamel}ToTerraform`;

      // Try to import the mapper from the generated resource module
      const resourceSnake = resource.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");

      // @ts-ignore - Dynamic require for optional dependency
      const module = require(`../../../.gen/providers/awscc/${serviceLower}-${resourceSnake}/index.js`);
      if (module[mapperName] && typeof module[mapperName] === "function") {
        return module[mapperName];
      }
    } catch (error) {
      // Mapper not found, that's ok - not all nested properties have mappers
      console.debug(`[aws-cdk-bridge] No mapper found for ${this.resourceType}.${propertyName}`);
    }

    return null;
  }

  /**
   * Resolve a value that may contain CloudFormation intrinsic functions
   */
  resolve(value: any, currentPath: string[] = []): any {
    if (value === null || value === undefined) {
      return undefined;
    }

    // Primitive types
    if (typeof value !== "object") {
      return value;
    }

    // Arrays
    if (Array.isArray(value)) {
      if (!this.recursive) return value;
      const resolved = value
        .map((item, idx) => this.resolve(item, [...currentPath, String(idx)]))
        .filter(item => item !== undefined);
      return resolved.length > 0 ? resolved : undefined;
    }

    // Check if this is an intrinsic function
    if (this.isIntrinsic(value)) {
      return this.resolveIntrinsic(value, currentPath);
    }

    // Regular object - recurse
    if (!this.recursive) return value;

    const resolved: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      const resolvedValue = this.resolve(val, [...currentPath, key]);
      if (resolvedValue !== undefined) {
        resolved[key] = resolvedValue;
      }
    }

    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }

  /**
   * Check if a value is a CloudFormation intrinsic function
   */
  private isIntrinsic(value: any): boolean {
    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const intrinsicKeys = [
      "Ref",
      "Fn::GetAtt",
      "Fn::Sub",
      "Fn::Join",
      "Fn::Split",
      "Fn::Select",
      "Fn::Base64",
      "Fn::Cidr",
      "Fn::FindInMap",
      "Fn::GetAZs",
      "Fn::ImportValue",
      "Fn::If",
      "Fn::Not",
      "Fn::Equals",
      "Fn::And",
      "Fn::Or",
      "Fn::Contains",
      "Fn::Length",
      "Fn::ToJsonString",
      "Fn::EachMemberEquals",
      "Fn::EachMemberIn",
      "Fn::Transform",
      "Fn::ForEach",
      "Fn::RefAll",
      "Fn::ValueOf",
      "Fn::ValueOfAll",
    ];

    return intrinsicKeys.some(key => key in value);
  }

  /**
   * Resolve an intrinsic function according to the strategy
   */
  private resolveIntrinsic(intrinsic: CfnIntrinsic, currentPath: string[]): any {
    const fnName = Object.keys(intrinsic)[0];

    switch (this.strategy) {
      case "skip":
        console.warn(
          `[aws-cdk-bridge] CloudFormation intrinsic function "${fnName}" was dropped during conversion. ` +
          `This may result in incomplete resource configuration. ` +
          `Consider handling this property manually or using resolutionStrategy: "cfncompat".`
        );
        return undefined;

      case "preserve":
        return intrinsic;

      case "cfncompat":
        return this.convertToCfncompat(intrinsic, currentPath);

      case "error":
        throw new Error(
          `CloudFormation intrinsic function "${fnName}" not supported`
        );

      default:
        return undefined;
    }
  }

  /**
   * Convert CloudFormation type to Terraform resource type
   * AWS::S3::Bucket -> awscc_s3_bucket
   * AWS::SecretsManager::Secret -> awscc_secretsmanager_secret
   */
  private cfnTypeToTerraformType(cfnType: string): string {
    const parts = cfnType.split("::");
    if (parts.length !== 3 || parts[0] !== "AWS") {
      return cfnType.toLowerCase().replace(/::/g, "_");
    }
    const [, service, resource] = parts;
    const snakeResource = resource.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    return `awscc_${service.toLowerCase()}_${snakeResource}`;
  }

  /**
   * Convert CloudFormation intrinsic to cfncompat provider function
   *
   * Now returns actual TypeScript function call results instead of string templates
   */
  private convertToCfncompat(intrinsic: CfnIntrinsic, currentPath: string[]): any {
    if ("Ref" in intrinsic) {
      const ref = intrinsic.Ref;
      // Handle AWS pseudo-parameters
      if (ref === "AWS::Region") {
        const regionDs = this.getRegionDataSource();
        if (regionDs) {
          return regionDs.name;
        }
        return "${data.aws_region.current.name}";
      }
      if (ref === "AWS::AccountId") {
        return "${data.aws_caller_identity.current.account_id}";
      }
      if (ref === "AWS::StackName") {
        return "${var.stack_name}";
      }
      // Handle AWS::NoValue - maps to null in Terraform
      if (ref === "AWS::NoValue") {
        return null;
      }
      // Regular resource references - convert logical ID to Terraform resource reference
      // Look up the CloudFormation type to determine the Terraform resource type
      const cfnType = this.resourceTypeMap.get(ref);
      if (cfnType) {
        const tfResourceType = this.cfnTypeToTerraformType(cfnType);
        return `\${${tfResourceType}.${ref}.id}`;
      }
      // Fallback if type not found in map
      return `\${var.${ref}}`;
    }

    if ("Fn::GetAtt" in intrinsic) {
      const value = intrinsic["Fn::GetAtt"];
      const [resource, attr] = Array.isArray(value) ? value : [value, ""];
      return `\${${resource}.${attr}}`;
    }

    // For other intrinsic functions that aren't commonly used, fall back to string templates for now
    // These could be enhanced later if needed

    if ("Fn::Join" in intrinsic) {
      const [delimiter, parts] = intrinsic["Fn::Join"];
      const resolvedParts = parts.map((p: any, idx: number) =>
        this.resolve(p, [...currentPath, "_join", String(idx)])
      );
      return CfncompatProviderFunctions.join(delimiter, resolvedParts);
    }

    if ("Fn::Split" in intrinsic) {
      const [delimiter, str] = intrinsic["Fn::Split"];
      const resolvedStr = this.resolve(str, [...currentPath, "_split"]);
      return CfncompatProviderFunctions.split(delimiter, resolvedStr);
    }

    if ("Fn::Select" in intrinsic) {
      const [index, list] = intrinsic["Fn::Select"];
      const resolvedList = this.resolve(list, [...currentPath, "_select"]);
      return CfncompatProviderFunctions.select(index, resolvedList);
    }

    if ("Fn::Sub" in intrinsic) {
      const value = intrinsic["Fn::Sub"];
      if (typeof value === "string") {
        // Simple string substitution
        if (!value.includes("${")) {
          // No variables - return as literal
          return value;
        }
        return CfncompatProviderFunctions.sub(value);
      } else if (Array.isArray(value)) {
        const [str, vars] = value;
        const resolvedVars: Record<string, any> = {};
        for (const [key, val] of Object.entries(vars)) {
          resolvedVars[key] = this.resolve(val, [...currentPath, "_sub", key]);
        }
        return CfncompatProviderFunctions.sub(str, resolvedVars);
      }
    }

    if ("Fn::Base64" in intrinsic) {
      const value = this.resolve(intrinsic["Fn::Base64"], [...currentPath, "_base64"]);
      return CfncompatProviderFunctions.base64(value);
    }

    if ("Fn::Cidr" in intrinsic) {
      const [ipBlock, count, cidrBits] = intrinsic["Fn::Cidr"];
      const resolvedIpBlock = this.resolve(ipBlock, [...currentPath, "_cidr"]);
      return CfncompatProviderFunctions.cidr(resolvedIpBlock, count, cidrBits);
    }

    if ("Fn::FindInMap" in intrinsic) {
      const [mapName, topKey, secondKey] = intrinsic["Fn::FindInMap"];
      return CfncompatProviderFunctions.findInMap(mapName, topKey, secondKey);
    }

    if ("Fn::If" in intrinsic) {
      const [conditionName, trueValue, falseValue] = intrinsic["Fn::If"];

      // First, resolve the condition from the template's Conditions section
      let conditionResult: any;
      if (this.conditions[conditionName]) {
        // Evaluate the condition expression
        conditionResult = this.resolve(this.conditions[conditionName], [...currentPath, "_condition_", conditionName]);
      } else {
        console.warn(`[aws-cdk-bridge] Condition "${conditionName}" not found in template`);
        conditionResult = false; // Default to false if condition not found
      }

      // Resolve the true/false branches
      const resolvedTrue = this.resolve(trueValue, [...currentPath, "_true"]);
      const resolvedFalse = this.resolve(falseValue, [...currentPath, "_false"]);

      // Check if we need to apply a xxxToTerraform mapper
      // This is needed when the property is a nested object (like StreamEncryption)
      const propertyName = currentPath[currentPath.length - 1];
      const mapper = this.getToTerraformMapper(propertyName);

      let mappedTrue = resolvedTrue;
      let mappedFalse = resolvedFalse;

      if (mapper && resolvedTrue !== null && typeof resolvedTrue === "object") {
        mappedTrue = mapper(resolvedTrue);
      }
      if (mapper && resolvedFalse !== null && typeof resolvedFalse === "object") {
        mappedFalse = mapper(resolvedFalse);
      }

      // Return the actual cfncompat function call
      return CfncompatProviderFunctions.conditionIf(conditionResult, mappedTrue, mappedFalse);
    }

    if ("Fn::Equals" in intrinsic) {
      const [left, right] = intrinsic["Fn::Equals"];
      const resolvedLeft = this.resolve(left, [...currentPath, "_left"]);
      const resolvedRight = this.resolve(right, [...currentPath, "_right"]);
      return CfncompatProviderFunctions.conditionEquals(resolvedLeft, resolvedRight);
    }

    if ("Fn::Not" in intrinsic) {
      const [value] = intrinsic["Fn::Not"];
      const resolvedValue = this.resolve(value, [...currentPath, "_not"]);
      return CfncompatProviderFunctions.conditionNot(resolvedValue);
    }

    if ("Fn::And" in intrinsic) {
      const conditions = intrinsic["Fn::And"].map((c: any, idx: number) =>
        this.resolve(c, [...currentPath, "_and", String(idx)])
      );
      return CfncompatProviderFunctions.conditionAnd(conditions);
    }

    if ("Fn::Or" in intrinsic) {
      const conditions = intrinsic["Fn::Or"].map((c: any, idx: number) =>
        this.resolve(c, [...currentPath, "_or", String(idx)])
      );
      return CfncompatProviderFunctions.conditionOr(conditions);
    }

    if ("Fn::Contains" in intrinsic) {
      const [list, value] = intrinsic["Fn::Contains"];
      const resolvedList = this.resolve(list, [...currentPath, "_list"]);
      const resolvedValue = this.resolve(value, [...currentPath, "_value"]);
      return CfncompatProviderFunctions.conditionContains(resolvedList, resolvedValue);
    }

    // Unsupported intrinsic - return as-is or undefined based on strategy
    return (this.strategy === "preserve" ? JSON.stringify(intrinsic) : undefined) as any;
  }
}

/**
 * Helper function to resolve CloudFormation properties
 */
export function resolveCfnProperties(
  properties: Record<string, any>,
  strategy: ResolutionStrategy = "skip"
): Record<string, any> {
  const resolver = new CfnExpressionResolver({ strategy, recursive: true });
  return resolver.resolve(properties) ?? {};
}

/**
 * Helper to check if a value contains any intrinsic functions
 */
export function containsIntrinsics(value: any): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(item => containsIntrinsics(item));
  }

  const intrinsicKeys = [
    "Ref", "Fn::GetAtt", "Fn::Sub", "Fn::Join", "Fn::Split",
    "Fn::Select", "Fn::Base64", "Fn::Cidr", "Fn::FindInMap",
    "Fn::GetAZs", "Fn::ImportValue", "Fn::If", "Fn::Not",
    "Fn::Equals", "Fn::And", "Fn::Or", "Fn::Contains",
  ];

  if (intrinsicKeys.some(key => key in value)) {
    return true;
  }

  return Object.values(value).some(val => containsIntrinsics(val));
}
