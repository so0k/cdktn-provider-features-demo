import { Construct } from "constructs";
import { App, LocalBackend, TerraformOutput, TerraformStack, Testing } from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { DataAwsRegion } from "./.gen/providers/aws/data-aws-region/index.ts";
import { AwsccProvider } from "./.gen/providers/awscc/provider/index.ts";
import { KinesisStream, kinesisStreamStreamEncryptionToTerraform } from "./.gen/providers/awscc/kinesis-stream/index.ts";
import { CfncompatProvider } from "./.gen/providers/cfncompat/provider/index.ts";
import { CfncompatProviderFunctions } from "./.gen/providers/cfncompat/provider-functions/index.ts";

/**
 * Port of aws-kinesis.Stream's default-encryption logic
 * (aws-cdk-lib/aws-kinesis/lib/stream.ts:985-1008, `parseEncryption()`) onto a
 * generated `awscc_kinesis_stream` resource + cfncompat's condition_* polyfills.
 *
 * The original CDK code, when no explicit `encryption`/`encryptionKey` is given,
 * defaults to KMS encryption everywhere except cn-north-1/cn-northwest-1 (where
 * KMS-encrypted streams aren't supported), expressed as:
 *
 *   new CfnCondition(stack, name, {
 *     expression: Fn.conditionOr(
 *       Fn.conditionEquals(Aws.REGION, 'cn-north-1'),
 *       Fn.conditionEquals(Aws.REGION, 'cn-northwest-1'),
 *     ),
 *   });
 *   streamEncryption: Fn.conditionIf(name, Aws.NO_VALUE, { EncryptionType: 'KMS', KeyId: 'alias/aws/kinesis' })
 *
 * `Aws.REGION` is CFN's `${AWS::Region}` pseudo-parameter, resolved by the
 * CloudFormation engine at deploy time -- its Terraform-native equivalent is the
 * `aws_region` data source, kept dynamic here (not hardcoded at synth time) to
 * preserve the same "resolved by the backend, not by CDK" laziness. `Aws.NO_VALUE`
 * (CFN's "omit this property") is ported as a literal `null` `streamEncryption`,
 * the closest Terraform analog for "don't set this optional nested attribute".
 *
 * This previously required two workarounds for cdktn bugs found while building
 * this example (calling `TerraformProviderFunction.invoke` directly instead of
 * the generated `conditionIf` wrapper, and using `{}` instead of a literal `null`)
 * -- both fixed upstream: `conditionIf`'s generated binding no longer force-coerces
 * its result through `Token.asString(...)` (which broke assignment to struct-typed
 * attributes like `streamEncryption`), and `TerraformProviderFunction.invoke` no
 * longer drops `null`/`undefined` positional arguments. See README UX notes for
 * the full history; this now uses the plain, idiomatic generated API.
 */
class L2KinesisStreamStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalBackend(this, { path: "terraform.tfstate" });

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
    const profile = process.env.AWS_ACCESS_KEY_ID ? undefined : process.env.AWS_PROFILE || "tcons-hermes";

    new AwsProvider(this, "aws", {
      region,
      profile,
      skipCredentialsValidation: true,
      skipRequestingAccountId: true,
      skipMetadataApiCheck: "true",
    });
    new AwsccProvider(this, "awscc", { region, profile });
    new CfncompatProvider(this, "cfncompat", {});

    const currentRegion = new DataAwsRegion(this, "current", {});

    const isUnsupportedRegion = CfncompatProviderFunctions.conditionOr([
      CfncompatProviderFunctions.conditionEquals(currentRegion.region, "cn-north-1"),
      CfncompatProviderFunctions.conditionEquals(currentRegion.region, "cn-northwest-1"),
    ]);

    const stream = new KinesisStream(this, "stream", {
      name: "cdktn-l2-port-demo-stream",
      shardCount: 1,
      // Fn.conditionIf(name, Aws.NO_VALUE, { EncryptionType: 'KMS', KeyId: 'alias/aws/kinesis' })
      // A provider-function argument is not a typed struct assignment, so it
      // is never run through the resource's generated xxxToTerraform mapper
      // the way a plain-literal `streamEncryption:` value would be -- the
      // object below would otherwise need to be hand-written in the
      // Terraform schema's own snake_case. Instead, call the generated
      // kinesisStreamStreamEncryptionToTerraform(...) mapper explicitly: it
      // takes the typed (camelCase) KinesisStreamStreamEncryption shape --
      // catching typos/wrong-type args at compile time, unlike conditionIf's
      // `any`-typed branches -- and produces the correctly-shaped snake_case
      // value. This is the same pattern already required for Lazy producers
      // returning a nested struct (see e.g. ~/tcons/base's distribution.ts/
      // dns-zone.ts), for the same underlying reason: any value that arrives
      // via a resolvable/token/produce() callback bypasses the synth-time
      // attribute-collection mapper and must be pre-mapped by hand.
      streamEncryption: CfncompatProviderFunctions.conditionIf(
        isUnsupportedRegion,
        null,
        kinesisStreamStreamEncryptionToTerraform({ encryptionType: "KMS", keyId: "alias/aws/kinesis" }),
      ),
    });

    new TerraformOutput(this, "region_name", { value: currentRegion.region });
    new TerraformOutput(this, "stream_name", { value: stream.name });
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new L2KinesisStreamStack(app, "l2-kinesis-stream");
app.synth();
