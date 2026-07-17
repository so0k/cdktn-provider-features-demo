/**
 * Transparent bridge: AWS CDK L2 Secret → CDKTN (via awscc provider)
 *
 * Uses generic fromAwsCdk() for automatic conversion.
 *
 * Bridge pattern:
 * 1. Internally synthesize real aws-cdk-lib Secret to CloudFormation (isolated)
 * 2. Extract CFN resource definition via introspection
 * 3. Create awscc_secretsmanager_secret resource in CDKTN tree
 * 4. Pass CFN properties directly (awscc provider accepts CFN schemas)
 *
 * The CDKTN app never sees CloudFormation - only native Terraform resources.
 *
 * Note: This is a convenience wrapper. For a fully generic approach, use
 * fromAwsCdk() directly.
 */

import { Construct } from "constructs";
import { Secret as CdkSecret, type SecretProps as CdkSecretProps } from "aws-cdk-lib/aws-secretsmanager";
import { SecretsmanagerSecret } from "../../../../.gen/providers/awscc/secretsmanager-secret/index.ts";
import { fromAwsCdk } from "../core/index.ts";
import { ensureProvidersLoaded } from "../core/provider-loader.ts";

export type SecretProps = CdkSecretProps;

export class Secret extends Construct {
  public readonly secretName: string;
  public readonly secretId: string;
  private readonly resource: SecretsmanagerSecret;

  constructor(scope: Construct, id: string, props: SecretProps) {
    super(scope, id);

    // Automatically ensure required providers are loaded
    ensureProvidersLoaded(scope);

    // Use generic TerraformResource factory for automatic conversion
    this.resource = fromAwsCdk({
      scope: this,
      id,
      constructFn: (cdkScope, cdkId) => new CdkSecret(cdkScope, cdkId, props),
      resourceClass: SecretsmanagerSecret,
      cfnType: "AWS::SecretsManager::Secret",
      resolutionStrategy: "cfncompat",
    });

    // Expose Terraform outputs (these are native Terraform references)
    this.secretName = this.resource.name;
    this.secretId = this.resource.id;
  }
}
