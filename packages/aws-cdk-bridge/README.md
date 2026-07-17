# aws-cdk-bridge

Transparent bridge from AWS CDK L1/L2 constructs to CDKTN (Terraform) using the awscc provider.

## Overview

This package provides a **generic, introspection-based** conversion mechanism that allows you to use AWS CDK constructs in CDKTN applications without writing manual bridge code.

### Key Features

- **Generic API**: `fromAwsCdk()` converts ANY CDK resource using introspection
- **No Manual Mapping**: Automatically extracts CloudFormation properties via synthesis
- **Type-Safe**: Preserves TypeScript types for both CDK and CDKTN resources
- **Transparent**: CloudFormation is used internally but never appears in output
- **Zero Overhead**: Conversion happens at synthesis time, no runtime cost

## Installation

```bash
npm install aws-cdk-bridge aws-cdk-lib cdktn constructs
```

## Quick Start

### Basic Usage

```typescript
import { TerraformResource } from "aws-cdk-bridge";
import { Bucket as CdkBucket } from "aws-cdk-lib/aws-s3";
import { S3Bucket } from ".gen/providers/awscc/s3-bucket";
import { App, TerraformStack } from "cdktn";

const app = new App();
const stack = new TerraformStack(app, "my-stack");

// Convert CDK Bucket to CDKTN S3Bucket
const bucket = fromAwsCdk({
  scope: stack,
  id: "MyBucket",
  constructFn: (cdkScope, cdkId) =>
    new CdkBucket(cdkScope, cdkId, {
      versioned: true,
      bucketName: "my-app-bucket",
    }),
  resourceClass: S3Bucket,
});

// Use Terraform outputs
console.log("Bucket ARN:", bucket.arn);
console.log("Bucket Name:", bucket.bucketName);
```

**Note:** The convenience wrappers (`Bucket`, `Stream`, `Secret`, etc.) automatically configure required providers (aws, awscc, cfncompat) if they haven't been registered yet. For the generic `fromAwsCdk()` approach shown above, you may need to manually configure providers depending on your `resolutionStrategy`.

### Using the Registry

Register resource classes once for automatic lookup:

```typescript
import { fromAwsCdk, ResourceClassRegistry } from "aws-cdk-bridge";

// Register at app startup
ResourceClassRegistry.register("AWS::S3::Bucket", S3Bucket);
ResourceClassRegistry.register("AWS::Lambda::Function", LambdaFunction);

// Now use without specifying resourceClass
const bucket = fromAwsCdk(
  stack,
  "MyBucket",
  (scope, id) => new CdkBucket(scope, id, { versioned: true })
);
const bucket = fromAwsCdk({
  scope: stack,
  id: "MyBucket",
  constructFn: (scope, id) => new CdkBucket(scope, id, { versioned: true }),
  cfnType: "AWS::S3::Bucket",
});
```

## API Reference

### `fromAwsCdk<T>(options): T`

Convert a CDK construct to a CDKTN resource using introspection.

**Parameters:**
- `scope`: CDKTN scope where resource will be created
- `id`: Construct ID for the CDKTN resource
- `constructFn`: Function that instantiates the CDK construct
- `resourceClass?`: CDKTN resource class to instantiate
- `cfnType?`: Optional CloudFormation type to filter (e.g., "AWS::S3::Bucket")
- `resourceIndex?`: Index of resource if multiple are created (default: 0)

**Returns:** Instance of the CDKTN resource

**Example:**
```typescript
const bucket = fromAwsCdk({
  scope: stack,
  id: "MyBucket",
  constructFn: (scope, id) => new CdkBucket(scope, id, { versioned: true }),
  resourceClass: S3Bucket, // Optional
  cfnType: "AWS::S3::Bucket", // Optional
});
```

### `inspect(constructFn, constructId?): CfnResourceMetadata[]`

Inspect CloudFormation metadata without creating a CDKTN resource.

**Parameters:**
- `constructFn`: Function that instantiates the CDK construct
- `constructId?`: Optional construct ID (default: "Resource")

**Returns:** Array of CloudFormation resource metadata

**Example:**
```typescript
const metadata = inspect(
  (scope, id) => new CdkBucket(scope, id, { versioned: true })
);

console.log("CloudFormation resources:");
metadata.forEach(m => {
  console.log(`  - ${m.type} (${m.logicalId})`);
  console.log(`    Properties:`, m.properties);
});
```

### `convertProperties(properties, options?): Record<string, any>`

Convert CloudFormation properties to Terraform format.

**Parameters:**
- `properties`: CloudFormation properties object
- `options?`:
  - `resolveRefs?`: Whether to skip intrinsic functions (default: false)

**Returns:** Converted properties object

**Example:**
```typescript
const cfnProps = {
  BucketName: "my-bucket",
  VersioningConfiguration: { Status: "Enabled" },
  BucketArn: { "Fn::GetAtt": ["MyBucket", "Arn"] },
};

const tfProps = convertProperties(cfnProps, {
  resolveRefs: true, // Skip intrinsic functions
});

console.log(tfProps);
// {
//   bucketName: "my-bucket",
//   versioningConfiguration: { status: "Enabled" }
// }
```

### `ResourceClassRegistry`

Global registry for CloudFormation type → CDKTN resource class mappings.

**Methods:**
- `register(cfnType, resourceClass)`: Register a mapping
- `get(cfnType)`: Get registered class for a CFN type
- `has(cfnType)`: Check if type is registered
- `types()`: Get all registered CFN types

**Example:**
```typescript
// Register
ResourceClassRegistry.register("AWS::S3::Bucket", S3Bucket);

// Check
if (ResourceClassRegistry.has("AWS::S3::Bucket")) {
  const Class = ResourceClassRegistry.get("AWS::S3::Bucket");
}

// List all
console.log("Registered types:", ResourceClassRegistry.types());
```

## How It Works

The bridge uses a three-step process:

### 1. Synthesis (Isolated)

```typescript
// Create isolated CDK scope
const cdkApp = new CdkApp();
const cdkStack = new CdkStack(cdkApp, "InternalBridgeStack");

// Instantiate CDK construct
new CdkBucket(cdkStack, "Bucket", props);

// Synthesize to CloudFormation
const assembly = cdkApp.synth();
const cfnTemplate = assembly.getStackByName("InternalBridgeStack").template;
```

### 2. Introspection

```typescript
// Extract CloudFormation resources
const resources = cfnTemplate.Resources || {};

for (const [logicalId, resource] of Object.entries(resources)) {
  const metadata = {
    type: resource.Type,           // "AWS::S3::Bucket"
    properties: resource.Properties, // { BucketName: "...", ... }
    logicalId: logicalId,          // "BucketABC123"
  };
}
```

### 3. Conversion

```typescript
// Convert CloudFormation properties to Terraform format
const tfConfig = convertProperties(metadata.properties, {
  resolveRefs: true, // Skip intrinsic functions
});

// Create CDKTN resource
const bucket = new S3Bucket(scope, id, tfConfig);
```

## Advanced Usage

### Multiple Resources

If a CDK construct creates multiple CloudFormation resources:

```typescript
// Inspect first
const metadata = TerraformResource.inspect((scope, id) => {
  new CdkBucket(scope, `${id}Main`, { versioned: true });
  new CdkBucket(scope, `${id}Logs`, { versioned: false });
});

console.log(`Found ${metadata.length} resources`);
// Found 2 resources

// Convert specific resource by index
const mainBucket = fromAwsCdk({
  scope: stack,
  id: "MainBucket",
  constructFn: /* ... */,
  resourceClass: S3Bucket,
  resourceIndex: 0, // First resource
});

// Or by CloudFormation type + index
const logsBucket = fromAwsCdk({
  scope: stack,
  id: "LogsBucket",
  constructFn: /* ... */,
  resourceClass: S3Bucket,
  cfnType: "AWS::S3::Bucket",
  resourceIndex: 1, // Second S3 bucket
});
```

### Intrinsic Functions

CloudFormation intrinsic functions are handled automatically:

```typescript
// CloudFormation properties with intrinsics
const cfnProps = {
  BucketName: "my-bucket",
  BucketArn: { "Fn::GetAtt": ["MyBucket", "Arn"] },
  BucketUrl: { "Fn::Sub": "https://${BucketName}.s3.amazonaws.com" },
};

// Convert with resolveRefs: true (skip intrinsics)
const tfProps = TerraformResource.convertProperties(cfnProps, {
  resolveRefs: true,
});

console.log(tfProps);
// {
//   bucketName: "my-bucket"
//   // Intrinsics are omitted
// }
```

Supported intrinsic functions:
- `Ref`
- `Fn::GetAtt`
- `Fn::Sub`
- `Fn::Join`
- `Fn::If`, `Fn::Not`, `Fn::Equals`, `Fn::And`, `Fn::Or`
- `Fn::FindInMap`, `Fn::Select`, `Fn::Split`
- `Fn::Base64`, `Fn::GetAZs`, `Fn::ImportValue`, `Fn::Cidr`

### Reusable Bridge Wrapper

Create a reusable bridge for common resources:

```typescript
class GenericCdkBridge<TCdk, TTf> {
  constructor(
    private cdkConstructor: new (scope: any, id: string, props: any) => TCdk,
    private tfResourceClass: new (scope: any, id: string, config: any) => TTf,
    private cfnType: string
  ) {}

  create(scope: any, id: string, props: any): TTf {
    return fromAwsCdk({
      scope,
      id,
      constructFn: (cdkScope, cdkId) =>
        new this.cdkConstructor(cdkScope, cdkId, props),
      resourceClass: this.tfResourceClass,
      cfnType: this.cfnType,
    });
  }
}

// Usage
const bucketBridge = new GenericCdkBridge(CdkBucket, S3Bucket, "AWS::S3::Bucket");
const bucket1 = bucketBridge.create(stack, "Bucket1", { versioned: true });
const bucket2 = bucketBridge.create(stack, "Bucket2", { versioned: false });
```

## Automatic Provider Loading

The convenience wrappers automatically configure required providers if they haven't been registered yet:
- **AwsProvider**: For data sources (e.g., `DataAwsRegion`)
- **AwsccProvider**: For CloudControl-based resources
- **CfncompatProvider**: For CloudFormation intrinsic function polyfills

If you prefer manual provider configuration, just configure them before creating resources:

```typescript
import { AwsProvider } from ".gen/providers/aws/provider";
import { AwsccProvider } from ".gen/providers/awscc/provider";
import { CfncompatProvider } from ".gen/providers/cfncompat/provider";

// Manual configuration (takes precedence)
new AwsProvider(stack, "aws", { region: "us-west-2" });
new AwsccProvider(stack, "awscc", { region: "us-west-2" });
new CfncompatProvider(stack, "cfncompat", {});

// Bridge will detect existing providers and not recreate them
const bucket = new Bucket(stack, "MyBucket", { versioned: true });
```

## Service-Specific Bridges

For convenience, the package includes pre-built wrappers for common AWS resources:

### S3 Bucket

```typescript
import { Bucket } from "aws-cdk-bridge/s3";

const bucket = new Bucket(stack, "MyBucket", {
  versioned: true,
  bucketName: "my-app-bucket",
});

// Access Terraform outputs
console.log(bucket.bucketArn);
console.log(bucket.bucketName);
console.log(bucket.bucketId);
```

### Secrets Manager Secret

```typescript
import { Secret } from "aws-cdk-bridge/secretsmanager";

const secret = new Secret(stack, "MySecret", {
  secretName: "my-app-secret",
  generateSecretString: {},
});

// Access Terraform outputs
console.log(secret.secretName);
console.log(secret.secretId);
```

### EC2 VPC

```typescript
import { Vpc } from "aws-cdk-bridge/ec2";

const vpc = new Vpc(stack, "MyVpc", {
  maxAzs: 2,
  cidr: "10.0.0.0/16",
});

// Access Terraform outputs
console.log(vpc.vpcId);
console.log(vpc.cidrBlock);
```

### EC2 Subnet

```typescript
import { Subnet } from "aws-cdk-bridge/ec2";

const subnet = new Subnet(stack, "MySubnet", {
  vpcId: vpc.vpcId,
  cidrBlock: "10.0.1.0/24",
  availabilityZone: "us-east-1a",
});

// Access Terraform outputs
console.log(subnet.subnetId);
console.log(subnet.availabilityZone);
```

### Kinesis Stream

```typescript
import { Stream } from "aws-cdk-bridge/kinesis";
import { StreamMode } from "aws-cdk-lib/aws-kinesis";

const stream = new Stream(stack, "MyStream", {
  streamName: "my-data-stream",
  streamMode: StreamMode.PROVISIONED,
  shardCount: 1,
});

// Access Terraform outputs
console.log(stream.streamArn);
console.log(stream.streamName);
```

### Supported Resources

Currently supported AWS resources:
- ✅ **S3**: Bucket
- ✅ **Secrets Manager**: Secret
- ✅ **EC2**: VPC, Subnet
- ✅ **Kinesis**: Stream

These wrappers use `fromAwsCdk()` internally but provide a cleaner API with proper TypeScript types and convenient property accessors.

## Testing

```bash
# Run tests
npm test

# Run specific test
npm test -- __tests__/generic-conversion.test.ts
```

## Limitations

- **awscc provider only**: Currently supports AWS resources via the awscc provider
- **Synthesis overhead**: Conversion requires CDK synthesis (happens once at synthesis time)
- **Intrinsic functions**: Complex intrinsics may not be fully resolved
- **Cross-resource references**: References between resources may need manual handling

## Roadmap

- [ ] Cross-resource reference resolution
- [ ] Optimized caching of synthesis results
- [ ] CLI tool for generating bridge code
- [ ] Support for custom L3 constructs

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

MIT
