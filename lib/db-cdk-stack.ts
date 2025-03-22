import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

import { Construct } from 'constructs';

export class DbCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPoolId = "ca-central-1_zGIpyDreL";
    const userPoolClientId = "3a5nhddh2l6mdudm3dq34elmq0";


    const signupLambda = new lambda.Function(this, 'HorizonSignupLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'signup.handler',
      code: lambda.Code.fromAsset('lambda/signup'),
      environment: {
          USER_POOL_ID: userPoolId,
          USER_POOL_CLIENT_ID: userPoolClientId,
      },
  });

  signupLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminInitiateAuth',
          'cognito-idp:AdminRespondToAuthChallenge',
          'cognito-idp:ResendConfirmationCode',
          'cognito-idp:ConfirmSignUp'
      ],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`],
  }));

  const defineAuthChallenge = new lambda.Function(this, 'HorizonDefineAuthChallenge', {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('lambda/signup/defineAuthChallenge'),
    environment: {
    },
});

const createAuthChallenge = new lambda.Function(this, 'HorizonCreateAuthChallenge', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/signup/createAuthChallenge'),
  environment: {
  },
});

const verifyAuthChallenge = new lambda.Function(this, 'HorizonVerifyAuthChallenge', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/signup/verifyAuthChallenge'),
  environment: {
  },
});


    // Create DynamoDB table - Startups
    const startupsTable = new dynamodb.Table(this, 'StartupsTable', {
      tableName: 'horizon-startups',
      partitionKey: { name: 'startup_name', type: dynamodb.AttributeType.STRING },
    });

    // Create DynamoDB table - Mentors
    const mentorsTable = new dynamodb.Table(this, 'MentorsTable', {
      tableName: 'horizon-mentors',
      partitionKey: { name: 'mentor_id', type: dynamodb.AttributeType.STRING },
    });

    const startupsFunction = new lambda.Function(this, 'StartupsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'startups.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        STARTUPS_TABLE_NAME: startupsTable.tableName,
      },
    });

    const mentorsFunction = new lambda.Function(this, 'MentorsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'mentors.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        MENTORS_TABLE_NAME: mentorsTable.tableName,
      },
    });

    startupsTable.grantReadWriteData(startupsFunction);
    mentorsTable.grantReadWriteData(mentorsFunction);


    const pitchDecksBucket = new s3.Bucket(this, 'PitchDecksBucket', {
      bucketName: 'tbdc-pitch-decks',
      removalPolicy: cdk.RemovalPolicy.RETAIN, 
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['*'], 
          allowedHeaders: ['*'],
        },
      ],
    });

    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcId: 'vpc-0b609b24aba691693' 
    });
    
    // Create security group for Lambda
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda to access internal services',
      allowAllOutbound: true
    });

    const uploadFunction = new lambda.Function(this, 'UploadFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'fileProcessing.lambda_handler',
      code: lambda.Code.fromAsset('lambda/file_processing', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c', [
              'pip install -r requirements.txt -t /asset-output',
              'cp -r /asset-input/* /asset-output'
            ].join(' && ')
          ],
        },
      }),
      environment: {
        BUCKET_NAME: pitchDecksBucket.bucketName,
        LLMSHERPA_API_URL: process.env.LLMSHERPA_API_URL || 'http://10.0.4.162:5001/api/parseDocument?renderFormat=all',
      },
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS 
      },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(60), 
      memorySize: 1024, 
    });
    
    pitchDecksBucket.grantReadWrite(uploadFunction);

    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'sessions',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
    });
    
    sessionsTable.addGlobalSecondaryIndex({
      indexName: 'DateTimeIndex',
      partitionKey: { name: 'date_partition', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'session_date_time', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const getSessionsFunction = new lambda.Function(this, 'GetSessionsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'sessions.handler',
      code: lambda.Code.fromAsset('lambda/sessions'),
      environment: {
        SESSIONS_TABLE_NAME: sessionsTable.tableName,
      },
    });

    sessionsTable.grantReadData(getSessionsFunction);

    const api = new apigateway.RestApi(this, 'StartupsApi', {
      restApiName: 'Startups and Mentors API',
      description: 'API to interact with Startups and Mentors',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const signupResource = api.root.addResource('signup');
    signupResource.addMethod('POST', new apigateway.LambdaIntegration(signupLambda));

    const confirmResource = api.root.addResource('confirm');
    confirmResource.addMethod('POST', new apigateway.LambdaIntegration(signupLambda));

    const startupsResource = api.root.addResource('startups');
    startupsResource.addMethod('GET', new apigateway.LambdaIntegration(startupsFunction));
    startupsResource.addMethod('POST', new apigateway.LambdaIntegration(startupsFunction));

    const startupResource = startupsResource.addResource('{startup_name}');
    startupResource.addMethod('GET', new apigateway.LambdaIntegration(startupsFunction));
    startupResource.addMethod('PUT', new apigateway.LambdaIntegration(startupsFunction));
    startupResource.addMethod('DELETE', new apigateway.LambdaIntegration(startupsFunction));

    const mentorsResource = api.root.addResource('mentors');
    mentorsResource.addMethod('GET', new apigateway.LambdaIntegration(mentorsFunction));
    mentorsResource.addMethod('POST', new apigateway.LambdaIntegration(mentorsFunction));

    const mentorResource = mentorsResource.addResource('{mentor_id}');
    mentorResource.addMethod('GET', new apigateway.LambdaIntegration(mentorsFunction));
    mentorResource.addMethod('PUT', new apigateway.LambdaIntegration(mentorsFunction));
    mentorResource.addMethod('DELETE', new apigateway.LambdaIntegration(mentorsFunction));

    const uploadsResource = api.root.addResource('uploads');
    uploadsResource.addMethod('POST', new apigateway.LambdaIntegration(uploadFunction));

    const sessionsResource = api.root.addResource('sessions');

    // GET /sessions - Get all sessions
    sessionsResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionsFunction));

    // POST /sessions - Create a new session
    sessionsResource.addMethod('POST', new apigateway.LambdaIntegration(getSessionsFunction));

    // GET /sessions/today - Get today's upcoming sessions
    const todayResource = sessionsResource.addResource('today');
    todayResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionsFunction));

    // GET/PUT/DELETE /sessions/{session_id} - Get, update, delete a specific session
    const sessionResource = sessionsResource.addResource('{session_id}');
    sessionResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionsFunction));
    sessionResource.addMethod('PUT', new apigateway.LambdaIntegration(getSessionsFunction));
    sessionResource.addMethod('DELETE', new apigateway.LambdaIntegration(getSessionsFunction));

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'The URL of the API Gateway',
    });
  }
}
