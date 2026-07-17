import { Construct } from "constructs";
import { App, Fn, LocalBackend, TerraformOutput, TerraformStack, Testing } from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { AwsProviderFunctions } from "./.gen/providers/aws/provider-functions/index.ts";
import { EphemeralAwsSecretsmanagerRandomPassword } from "./.gen/providers/aws/ephemeral-aws-secretsmanager-random-password/index.ts";

/**
 * Exercises AWS provider-protocol features generated from Terraform 1.15.x schema:
 * - provider-defined functions (`provider::aws::arn_build`, `provider::aws::user_agent`)
 * - ephemeral resources (`ephemeral.aws_secretsmanager_random_password`)
 * - targetVersions-aware synth validation from the PR head
 *
 * This stack intentionally avoids creating AWS infrastructure. It should synthesize
 * and `terraform plan -refresh=false` with any usable AWS profile.
 */
class AwsFunctionsAndEphemeralStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new LocalBackend(this, { path: "terraform.tfstate" });

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
    // Only force a named profile when no direct credential env vars are present.
    // Setting `profile` alongside AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (e.g. from
    // `aws-vault exec ... --`) makes the AWS Go SDK resolve credentials from that
    // profile's ~/.aws/config block instead of the injected env credentials, which
    // fails when the profile has no static credentials of its own.
    const profile = process.env.AWS_ACCESS_KEY_ID ? undefined : process.env.AWS_PROFILE || "tcons-hermes";

    new AwsProvider(this, "aws", {
      region,
      profile,
      skipCredentialsValidation: true,
      skipRequestingAccountId: true,
      skipMetadataApiCheck: "true",
    });

    const builtArn = AwsProviderFunctions.arnBuild(
      "aws",
      "s3",
      "",
      "",
      "demo-bucket"
    );

    const generatedPassword = new EphemeralAwsSecretsmanagerRandomPassword(
      this,
      "GeneratedPassword",
      {
        passwordLength: 24,
        excludePunctuation: true,
        requireEachIncludedType: true,
        // Exercises TerraformEphemeralResourceLifecycle, which narrows the
        // ephemeral lifecycle block to precondition/postcondition only -
        // createBeforeDestroy/preventDestroy/ignoreChanges/replaceTriggeredBy
        // don't apply to stateless ephemeral resources and are rejected at
        // compile time. The postcondition checks a non-sensitive computed
        // attribute; referencing the sensitive `random_password` attribute
        // here would fail Terraform's sensitive-value-in-condition check.
        lifecycle: {
          postcondition: [
            {
              condition: "${self.password_length == 24}",
              errorMessage: "expected Secrets Manager to honor the requested password length",
            },
          ],
        },
      }
    );

    new TerraformOutput(this, "provider_function_arn_build", {
      value: builtArn,
    });

    new TerraformOutput(this, "ephemeral_password_ref_as_null", {
      value: Fn.ephemeralasnull(generatedPassword.randomPassword),
      sensitive: true,
    });

    // Same provider_meta escape hatch as functions-only, but here it's verifiable end
    // to end: this stack's ephemeral resource makes a real Secrets Manager API call, so
    // the resulting User-Agent header can be inspected with TF_LOG=DEBUG.
    this.addOverride("terraform.provider_meta.aws", {
      user_agent: [
        AwsProviderFunctions.userAgent(
          "cdktn-provider-features-demo",
          "0.1.0",
          "cdktn-demo-verify-9f3a"
        ),
      ],
    });
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new AwsFunctionsAndEphemeralStack(app, "functions-ephemeral");
app.synth();
