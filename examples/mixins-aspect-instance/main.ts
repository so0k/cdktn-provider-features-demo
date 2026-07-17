import { Construct, IConstruct, IMixin } from "constructs";
import {
  Annotations,
  App,
  Aspects,
  IAspect,
  LocalBackend,
  TerraformStack,
  Testing,
} from "cdktn";
import { AwsProvider } from "./.gen/providers/aws/provider/index.ts";
import { Instance } from "./.gen/providers/aws/instance/index.ts";

/**
 * Verifies the docs' "configure with a mixin, validate with an aspect" pairing.
 * Mixin — opt a specific instance in (imperative, immediate).
 */
class RequireImdsv2 implements IMixin {
  supports(construct: IConstruct): boolean {
    return construct instanceof Instance;
  }
  applyTo(construct: IConstruct): void {
    (construct as Instance).putMetadataOptions({ httpTokens: "required" });
  }
}

// Aspect — govern the whole app (deferred, validating).
class ValidateImdsv2 implements IAspect {
  visit(node: IConstruct): void {
    if (
      node instanceof Instance &&
      node.metadataOptionsInput?.httpTokens !== "required"
    ) {
      Annotations.of(node).addError("EC2 instances must require IMDSv2 (httpTokens: required).");
    }
  }
}

class MixinsAspectInstanceStack extends TerraformStack {
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

    // Configure the instance you create...
    new Instance(this, "web", { ami: "ami-0123456789abcdef0", instanceType: "t3.micro" }).with(
      new RequireImdsv2(),
    );

    // ...and validate everything, including instances you didn't create yourself.
    Aspects.of(this).add(new ValidateImdsv2());
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new MixinsAspectInstanceStack(app, "mixins-aspect-instance");
app.synth();
