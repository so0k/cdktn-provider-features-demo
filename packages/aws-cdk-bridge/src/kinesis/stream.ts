/**
 * Transparent bridge: AWS CDK L2 Stream → CDKTN (via awscc provider)
 *
 * Uses generic fromAwsCdk() for automatic conversion.
 *
 * Bridge pattern:
 * 1. Internally synthesize real aws-cdk-lib Stream to CloudFormation (isolated)
 * 2. Extract CFN resource definition via introspection
 * 3. Convert CloudFormation intrinsics to CfncompatProviderFunctions calls
 * 4. Apply xxxToTerraform mappers for nested objects
 * 5. Create awscc_kinesis_stream resource in CDKTN tree
 *
 * The CDKTN app never sees CloudFormation - only native Terraform resources.
 *
 * ## Default Encryption Behavior
 *
 * When no explicit `encryption` or `encryptionKey` is provided, AWS CDK's Stream construct
 * defaults to KMS encryption (except in cn-north-1/cn-northwest-1 where KMS streams aren't
 * supported). This is implemented using CloudFormation's `Fn::If` intrinsic function.
 *
 * **This bridge automatically handles the conditional encryption logic** by:
 * 1. Creating a `DataAwsRegion` data source to get the current region
 * 2. Converting `Fn::If`/`Fn::Or`/`Fn::Equals` to `CfncompatProviderFunctions` calls
 * 3. Applying `kinesisStreamStreamEncryptionToTerraform()` to the encryption object
 *
 * The result matches CDK's behavior: KMS encryption everywhere except China regions.
 *
 *
 * Note: This is a convenience wrapper. For a fully generic approach, use
 * fromAwsCdk() directly.
 */

import { Construct } from "constructs";
import { Stream as CdkStream, type StreamProps as CdkStreamProps } from "aws-cdk-lib/aws-kinesis";
import { KinesisStream } from "../../../../.gen/providers/awscc/kinesis-stream/index.ts";
import { fromAwsCdk } from "../core/index.ts";
import { ensureProvidersLoaded } from "../core/provider-loader.ts";

export type StreamProps = CdkStreamProps;

export class Stream extends Construct {
  public readonly streamArn: string;
  public readonly streamName: string;
  private readonly resource: KinesisStream;

  constructor(scope: Construct, id: string, props: StreamProps) {
    super(scope, id);

    // Automatically ensure required providers are loaded
    ensureProvidersLoaded(scope);

    // Use generic TerraformResource factory for automatic conversion
    // resolutionStrategy: "cfncompat" converts CloudFormation intrinsics (like Fn::If)
    // to CfncompatProviderFunctions calls with automatic xxxToTerraform mapping
    this.resource = fromAwsCdk({
      scope: this,
      id,
      constructFn: (cdkScope, cdkId) => new CdkStream(cdkScope, cdkId, props),
      resourceClass: KinesisStream,
      cfnType: "AWS::Kinesis::Stream",
      resolutionStrategy: "cfncompat",
    });

    // Expose Terraform outputs (these are native Terraform references)
    this.streamArn = this.resource.arn;
    this.streamName = this.resource.name;
  }
}
