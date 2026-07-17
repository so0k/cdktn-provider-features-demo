/**
 * Transparent bridge: AWS CDK L2 Vpc → CDKTN (via awscc provider)
 *
 * Uses generic fromAwsCdk() for automatic conversion.
 *
 * Bridge pattern:
 * 1. Internally synthesize real aws-cdk-lib Vpc to CloudFormation (isolated)
 * 2. Extract CFN resource definition via introspection
 * 3. Create awscc_ec2_vpc resource in CDKTN tree
 * 4. Pass CFN properties directly (awscc provider accepts CFN schemas)
 *
 * The CDKTN app never sees CloudFormation - only native Terraform resources.
 *
 * Note: This is a convenience wrapper. For a fully generic approach, use
 * fromAwsCdk() directly.
 */

import { Construct } from "constructs";
import { Vpc as CdkVpc, type VpcProps as CdkVpcProps } from "aws-cdk-lib/aws-ec2";
import { Ec2Eip } from "../../../../.gen/providers/awscc/ec2-eip/index.ts";
import { Ec2InternetGateway } from "../../../../.gen/providers/awscc/ec2-internet-gateway/index.ts";
import { Ec2NatGateway } from "../../../../.gen/providers/awscc/ec2-nat-gateway/index.ts";
import { Ec2Route } from "../../../../.gen/providers/awscc/ec2-route/index.ts";
import { Ec2RouteTable } from "../../../../.gen/providers/awscc/ec2-route-table/index.ts";
import { Ec2Subnet } from "../../../../.gen/providers/awscc/ec2-subnet/index.ts";
import { Ec2SubnetRouteTableAssociation } from "../../../../.gen/providers/awscc/ec2-subnet-route-table-association/index.ts";
import { Ec2Vpc } from "../../../../.gen/providers/awscc/ec2-vpc/index.ts";
import { Ec2VpcGatewayAttachment } from "../../../../.gen/providers/awscc/ec2-vpc-gateway-attachment/index.ts";
import { fromAwsCdk, ResourceClassRegistry } from "../core/index.ts";
import { ensureProvidersLoaded } from "../core/provider-loader.ts";

export type VpcProps = CdkVpcProps;

export class Vpc extends Construct {
  public readonly vpcId: string;
  public readonly cidrBlock: string;
  private readonly resource: Ec2Vpc;

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id);

    // Automatically ensure required providers are loaded
    ensureProvidersLoaded(scope);

    ResourceClassRegistry.register("AWS::EC2::EIP", Ec2Eip);
    ResourceClassRegistry.register("AWS::EC2::InternetGateway", Ec2InternetGateway);
    ResourceClassRegistry.register("AWS::EC2::NatGateway", Ec2NatGateway);
    ResourceClassRegistry.register("AWS::EC2::Route", Ec2Route);
    ResourceClassRegistry.register("AWS::EC2::RouteTable", Ec2RouteTable);
    ResourceClassRegistry.register("AWS::EC2::Subnet", Ec2Subnet);
    ResourceClassRegistry.register("AWS::EC2::SubnetRouteTableAssociation", Ec2SubnetRouteTableAssociation);
    ResourceClassRegistry.register("AWS::EC2::VPCGatewayAttachment", Ec2VpcGatewayAttachment);

    // Use generic TerraformResource factory for automatic conversion
    this.resource = fromAwsCdk({
      scope: this,
      id,
      constructFn: (cdkScope, cdkId) => new CdkVpc(cdkScope, cdkId, props),
      resourceClass: Ec2Vpc,
      cfnType: "AWS::EC2::VPC",
      resolutionStrategy: "cfncompat",
    });

    // Expose Terraform outputs (these are native Terraform references)
    this.vpcId = this.resource.id;
    this.cidrBlock = this.resource.cidrBlock;
  }
}
