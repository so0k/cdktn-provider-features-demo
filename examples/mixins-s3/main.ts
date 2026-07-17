import { Construct, IConstruct, IMixin } from "constructs";
import { App, LocalBackend, TerraformResource, TerraformStack, Testing } from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { S3Bucket } from "./.gen/providers/aws/s3-bucket/index.ts";

/**
 * Verifies the "Mixins" concept doc's provider-agnostic example (docs/concept-mixins,
 * content/concepts/mixins.mdx): TerraformResource.isTerraformResource(...) as a
 * supports() guard, and resource.lifecycle as the applyTo() mutation.
 */
class PreventDestroy implements IMixin {
  supports(construct: IConstruct): boolean {
    return TerraformResource.isTerraformResource(construct);
  }

  applyTo(construct: IConstruct): void {
    const resource = construct as TerraformResource;
    resource.lifecycle = { ...resource.lifecycle, preventDestroy: true };
  }
}

/**
 * Verifies the docs' provider-specific example: a narrowed `instanceof` supports()
 * guard, and addOverride(...) as an escape hatch that doesn't depend on a specific
 * generated provider version's typed API.
 */
class EnableVersioning implements IMixin {
  supports(construct: IConstruct): boolean {
    return construct instanceof S3Bucket;
  }

  applyTo(construct: IConstruct): void {
    (construct as S3Bucket).addOverride("versioning", { enabled: true });
  }
}

class MixinsS3Stack extends TerraformStack {
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

    // Multiple mixins applied at once, in order — matches the docs' "PreventDestroy
    // + EnableVersioning" combination.
    new S3Bucket(this, "data", { bucket: "cdktn-mixins-demo-data" }).with(
      new PreventDestroy(),
      new EnableVersioning(),
    );
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new MixinsS3Stack(app, "mixins-s3");
app.synth();
