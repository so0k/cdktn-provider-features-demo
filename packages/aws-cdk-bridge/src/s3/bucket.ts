/**
 * Transparent bridge: AWS CDK L2 Bucket → CDKTN (via awscc provider)
 *
 * Uses generic fromAwsCdk() for automatic conversion.
 *
 * Bridge pattern:
 * 1. Internally synthesize real aws-cdk-lib Bucket to CloudFormation (isolated)
 * 2. Extract CFN resource definition via introspection
 * 3. Create awscc_s3_bucket resource in CDKTN tree
 * 4. Pass CFN properties directly (awscc provider accepts CFN schemas)
 *
 * The CDKTN app never sees CloudFormation - only native Terraform resources.
 *
 * Note: This is a convenience wrapper. For a fully generic approach, use
 * fromAwsCdk() directly.
 */

import { Construct } from "constructs";
import { Bucket as CdkBucket, type BucketProps as CdkBucketProps } from "aws-cdk-lib/aws-s3";
import { S3Bucket } from "../../../../.gen/providers/awscc/s3-bucket/index.ts";
import { fromAwsCdk } from "../core/index.ts";
import { ensureProvidersLoaded } from "../core/provider-loader.ts";

export type BucketProps = CdkBucketProps;

export class Bucket extends Construct {
  public readonly bucketArn: string;
  public readonly bucketName: string;
  public readonly bucketId: string;
  private readonly resource: S3Bucket;

  constructor(scope: Construct, id: string, props: BucketProps) {
    super(scope, id);

    // Automatically ensure required providers are loaded
    ensureProvidersLoaded(scope);

    // Use generic TerraformResource factory for automatic conversion
    this.resource = fromAwsCdk({
      scope: this,
      id,
      constructFn: (cdkScope, cdkId) => new CdkBucket(cdkScope, cdkId, props),
      resourceClass: S3Bucket,
      cfnType: "AWS::S3::Bucket",
      resolutionStrategy: "cfncompat",
    });

    // Expose Terraform outputs (these are native Terraform references)
    this.bucketArn = this.resource.arn;
    this.bucketName = this.resource.bucketName;
    this.bucketId = this.resource.id;
  }
}
