/**
 * Automatic provider loader for bridge convenience wrappers
 *
 * Ensures required providers (aws, awscc, cfncompat) are configured before
 * resource creation, automatically creating them if they don't exist.
 */

import { TerraformProvider } from "cdktn";
import type { Construct } from "constructs";
import { AwsProvider } from "../../../../.gen/providers/aws/provider/index.ts";
import { AwsccProvider } from "../../../../.gen/providers/awscc/provider/index.ts";
import { CfncompatProvider } from "../../../../.gen/providers/cfncompat/provider/index.ts";

/**
 * Get a provider if is already registered in the scope
 */
const getProvider = (scope: Construct, providerName: string): TerraformProvider | null => {
  // Walk up the tree to find if a provider of this type exists
  let current: Construct | undefined = scope;

  while (current) {
    // Check if this node has the provider
    const node = (current as any).node;
    if (node) {
      const children = node.children || [];
      const hasMatchingProvider = children.some((child: any) => {
        const childFqn = child.constructor?.name;
        return childFqn && childFqn.toLowerCase().includes(providerName.toLowerCase());
      });

      if (hasMatchingProvider) {
        return hasMatchingProvider;
      }
    }

    // Move up to parent
    current = (current as any).node?.scope;
  }

  return null;
};

/**
 * Get the stack from a scope (walk up the tree)
 */
const getStack = (scope: Construct): Construct => {
  let current: Construct = scope;

  while (current) {
    const className = current.constructor?.name || "";
    if (className.includes("Stack") || className.includes("TerraformStack")) {
      return current;
    }
    const parent = (current as any).node?.scope;
    if (!parent) break;
    current = parent;
  }

  return scope; // Fallback to the provided scope
};

/**
 * Options for provider loading
 */
export interface ProviderLoaderOptions {
  /** Force provider creation even if one exists */
  force?: boolean;
}

/**
 * Ensure required providers are loaded for cfncompat strategy
 *
 * Automatically creates:
 * - AwsProvider (for data sources like DataAwsRegion)
 * - AwsccProvider (for CloudControl resources)
 * - CfncompatProvider (for intrinsic function polyfills)
 */
export const  ensureProvidersLoaded = (
  scope: Construct,
  options: ProviderLoaderOptions = {}
): void => {
  const { force = false } = options;

  // Get the stack to register providers at the root
  const stack = getStack(scope);
  
  let awsProvider: AwsProvider | null = getProvider(stack, "AwsProvider");

  // Load AWS provider (for data sources)
  if (force || !awsProvider) {
    try {
      awsProvider = new AwsProvider(stack, "bridge_aws", {});
    } catch (error) {
      console.warn("[aws-cdk-bridge] Could not load AwsProvider:", error instanceof Error ? error.message : error);
    }
  }

  // Load AWSCC provider (for CloudControl resources)
  if (force || !getProvider(stack, "AwsccProvider")) {
    try {
      new AwsccProvider(stack, "bridge_awscc", {
        region: awsProvider.region,
        profile: awsProvider.profile
      });
    } catch (error) {
      console.warn("[aws-cdk-bridge] Could not load AwsccProvider:", error instanceof Error ? error.message : error);
    }
  }

  // Load Cfncompat provider (for intrinsic function polyfills)
  if (force || !getProvider(stack, "CfncompatProvider")) {
    try {
      new CfncompatProvider(stack, "bridge_cfncompat", {
        region: awsProvider.region,
        profile: awsProvider.profile
      });
    } catch (error) {
      console.warn("[aws-cdk-bridge] Could not load CfncompatProvider:", error instanceof Error ? error.message : error);
    }
  }
};
