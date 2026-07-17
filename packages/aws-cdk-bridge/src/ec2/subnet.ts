/**
 * Transparent bridge: AWS CDK L2 Subnet → CDKTN (via awscc provider)
 *
 * Uses generic fromAwsCdk() for automatic conversion.
 *
 * Bridge pattern:
 * 1. Internally synthesize real aws-cdk-lib Subnet to CloudFormation (isolated)
 * 2. Extract CFN resource definition via introspection
 * 3. Create awscc_ec2_subnet resource in CDKTN tree
 * 4. Pass CFN properties directly (awscc provider accepts CFN schemas)
 *
 * The CDKTN app never sees CloudFormation - only native Terraform resources.
 *
 * Note: This is a convenience wrapper. For a fully generic approach, use
 * fromAwsCdk() directly.
 */

import { Construct } from "constructs";
import { Subnet as CdkSubnet, type SubnetProps as CdkSubnetProps } from "aws-cdk-lib/aws-ec2";
import { Ec2Subnet } from "../../../../.gen/providers/awscc/ec2-subnet/index.ts";
import { fromAwsCdk } from "../core/index.ts";
import { ensureProvidersLoaded } from "../core/provider-loader.ts";

export type SubnetProps = CdkSubnetProps;

export class Subnet extends Construct {
  public readonly subnetId: string;
  public readonly availabilityZone: string;
  private readonly resource: Ec2Subnet;

  constructor(scope: Construct, id: string, props: SubnetProps) {
    super(scope, id);

    // Automatically ensure required providers are loaded
    ensureProvidersLoaded(scope);

    // Use generic TerraformResource factory for automatic conversion
    this.resource = fromAwsCdk({
      scope: this,
      id,
      constructFn: (cdkScope, cdkId) => new CdkSubnet(cdkScope, cdkId, props),
      resourceClass: Ec2Subnet,
      cfnType: "AWS::EC2::Subnet",
      resolutionStrategy: "cfncompat",
    });

    // Expose Terraform outputs (these are native Terraform references)
    this.subnetId = this.resource.id;
    this.availabilityZone = this.resource.availabilityZone;
  }
}
