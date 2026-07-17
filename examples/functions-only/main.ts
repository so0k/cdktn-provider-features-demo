import { Construct } from "constructs";
import { App, LocalBackend, TerraformOutput, TerraformStack, Testing } from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { AwsProviderFunctions } from "./.gen/providers/aws/provider-functions/index.ts";

class AwsProviderFunctionsOnlyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new LocalBackend(this, { path: "terraform.tfstate" });

    new AwsProvider(this, "aws", {
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
      // Only force a named profile when no direct credential env vars are present.
      // Setting `profile` alongside AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (e.g. from
      // `aws-vault exec ... --`) makes the AWS Go SDK resolve credentials from that
      // profile's ~/.aws/config block instead of the injected env credentials, which
      // fails when the profile has no static credentials of its own.
      profile: process.env.AWS_ACCESS_KEY_ID ? undefined : process.env.AWS_PROFILE || "tcons-hermes",
      skipCredentialsValidation: true,
      skipRequestingAccountId: true,
      skipMetadataApiCheck: "true",
    });

    const parsed = AwsProviderFunctions.arnParse(
      "arn:aws:iam::123456789012:role/service-role/demo"
    );

    new TerraformOutput(this, "built_arn", {
      value: AwsProviderFunctions.arnBuild(
        "aws",
        "logs",
        "us-east-1",
        "123456789012",
        "log-group:/aws/lambda/demo"
      ),
    });

    new TerraformOutput(this, "trimmed_role_path", {
      value: AwsProviderFunctions.trimIamRolePath(
        "arn:aws:iam::123456789012:role/service-role/demo"
      ),
    });

    new TerraformOutput(this, "parsed_arn", {
      value: parsed,
    });

    // provider::aws::user_agent is namespaced to the "aws" provider, so it must be
    // called after provider configuration exists (see README's UX notes on the
    // provider self-reference cycle if invoked from within the AwsProvider block).
    new TerraformOutput(this, "user_agent_suffix", {
      value: AwsProviderFunctions.userAgent(
        "cdktn-provider-features-demo",
        "0.1.0",
        "provider-defined-function-smoke-test"
      ),
    });

    // The function's intended usage (terraform-provider-aws #45464) is module-scoped
    // User-Agent tagging via `terraform { provider_meta "aws" { user_agent = [...] } }`,
    // not a plain output. cdktn has no first-class construct for `provider_meta`, so this
    // uses the `addOverride` escape hatch to inject it into the stack's `terraform` block.
    this.addOverride("terraform.provider_meta.aws", {
      user_agent: [
        AwsProviderFunctions.userAgent(
          "cdktn-provider-features-demo",
          "0.1.0",
          "provider-meta module tagging smoke test"
        ),
      ],
    });
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new AwsProviderFunctionsOnlyStack(app, "functions-only");
app.synth();
