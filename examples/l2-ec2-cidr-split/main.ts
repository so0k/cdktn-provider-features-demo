import { Construct } from "constructs";
import { App, LocalBackend, TerraformOutput, TerraformStack, Testing } from "cdktn";
import { AwsccProvider } from "./.gen/providers/awscc/provider/index.ts";
import { Ec2Vpc } from "./.gen/providers/awscc/ec2-vpc/index.ts";
import { Ec2Subnet } from "./.gen/providers/awscc/ec2-subnet/index.ts";
import { CfncompatProvider } from "./.gen/providers/cfncompat/provider/index.ts";
import { CfncompatProviderFunctions } from "./.gen/providers/cfncompat/provider-functions/index.ts";

/**
 * Port of aws-ec2's CIDR-splitting helper
 * (aws-cdk-lib/aws-ec2/lib/ip-addresses.ts:334, `cidrSplitToCfnExpression()`, as
 * used by `Vpc`'s subnet allocation) onto generated `awscc_ec2_vpc`/`awscc_ec2_subnet`
 * resources + cfncompat's `cidr`/`select` polyfills -- the most literal match to a
 * named cfncompat function, and the motivating "CIDR/subnet math" example the
 * cfncompat PRD (000-PRD.md, gap G3) calls out explicitly.
 *
 * The original CDK code:
 *
 *   return Fn.select(split.index, Fn.cidr(parentCidr, split.count, `${32 - split.netmask}`));
 *
 * splits a parent CIDR block into `count` equally-sized subnets and selects one
 * by index. `parentCidr` here is the VPC's own `cidrBlock` attribute -- deliberately
 * kept as a resource-attribute reference (not a synth-time string literal) so the
 * split is computed by the provider once the VPC's real CIDR is known, exactly
 * mirroring the CFN original where `Fn::Cidr` runs against a value CloudFormation
 * resolves during deployment, not during template synthesis.
 *
 * Scoped to a single-VPC, 4-subnet /24 split (not the full multi-resource `Vpc`
 * L2, which also wires route tables, NAT/internet gateways, and EIPs -- out of
 * scope for this focused polyfill demo).
 */
class L2Ec2CidrSplitStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalBackend(this, { path: "terraform.tfstate" });

    new AwsccProvider(this, "awscc", {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
      profile: process.env.AWS_ACCESS_KEY_ID ? undefined : process.env.AWS_PROFILE || "tcons-hermes",
    });
    new CfncompatProvider(this, "cfncompat", {});

    const vpc = new Ec2Vpc(this, "vpc", {
      cidrBlock: "10.0.0.0/16",
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    // Fn.cidr(parentCidr, count, cidrBits): 4 /24s (32 - 24 = 8 subnet bits) from a /16.
    const subnetCount = 4;
    const subnetCidrs = CfncompatProviderFunctions.cidr(vpc.cidrBlock, subnetCount, 8);

    for (let index = 0; index < subnetCount; index += 1) {
      const subnet = new Ec2Subnet(this, `subnet-${index}`, {
        vpcId: vpc.vpcId,
        // Fn.select(split.index, Fn.cidr(...))
        cidrBlock: CfncompatProviderFunctions.select(index, subnetCidrs),
      });
      new TerraformOutput(this, `subnet_${index}_cidr`, { value: subnet.cidrBlock });
    }

    new TerraformOutput(this, "vpc_cidr", { value: vpc.cidrBlock });
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new L2Ec2CidrSplitStack(app, "l2-ec2-cidr-split");
app.synth();
