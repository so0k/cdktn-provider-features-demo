import { Construct, IConstruct, IMixin } from "constructs";
import { App, LocalBackend, TerraformStack, Testing } from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { S3Bucket } from "./.gen/providers/aws/s3-bucket/index.ts";
import { DynamodbTable } from "./.gen/providers/aws/dynamodb-table/index.ts";

/**
 * Verifies the docs' multi-resource-type mixin example: one mixin, one supports()
 * guard spanning two unrelated resource types, and a distinct applyTo() branch per
 * type using each generated class's typed `put*` method (not addOverride).
 */
class DataRecovery implements IMixin {
  supports(construct: IConstruct): boolean {
    return construct instanceof S3Bucket || construct instanceof DynamodbTable;
  }

  applyTo(construct: IConstruct): void {
    if (construct instanceof S3Bucket) {
      construct.putVersioning({ enabled: true });
    }
    if (construct instanceof DynamodbTable) {
      construct.putPointInTimeRecovery({ enabled: true });
    }
  }
}

class MixinsDataRecoveryStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalBackend(this, { path: "terraform.tfstate" });

    new AwsProvider(this, "aws", {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
      profile: process.env.AWS_ACCESS_KEY_ID ? undefined : process.env.AWS_PROFILE || "tcons-hermes",
      skipCredentialsValidation: true,
      skipRequestingAccountId: true,
      skipMetadataApiCheck: "true",
    });

    new S3Bucket(this, "data", { bucket: "cdktn-mixins-demo-data-recovery" }).with(
      new DataRecovery(),
    );

    new DynamodbTable(this, "table", {
      name: "cdktn-mixins-demo-table",
      billingMode: "PAY_PER_REQUEST",
      hashKey: "id",
      attribute: [{ name: "id", type: "S" }],
    }).with(new DataRecovery());
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new MixinsDataRecoveryStack(app, "mixins-data-recovery");
app.synth();
