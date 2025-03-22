import { 
    CognitoIdentityProviderClient, 
    SignUpCommand, 
    InitiateAuthCommand, 
    RespondToAuthChallengeCommand,
    AdminConfirmSignUpCommand,
    AdminGetUserCommand // Import AdminGetUser Command to fetch user attributes
  } from "@aws-sdk/client-cognito-identity-provider";
  
  const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
  const USER_POOL_ID = process.env.USER_POOL_ID;
  const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID;
  
  export const handler = async (event) => {
    // Determine which route to handle based on the path
    const path = event.path || (event.requestContext && event.requestContext.path);
    if (path.includes('/signup')) {
        return handleSignup(event);
    } else if (path.includes('/confirm')) {
        return handleConfirm(event);
    } else {
        return {
            statusCode: 404,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "Route not found" })
        };
    }
  };
  
  async function handleSignup(event) {
    try {
        const { email } = JSON.parse(event.body);
        let isNewUser  = false;
  
        // Initiate auth with CUSTOM_AUTH
        const authParams = {
            AuthFlow: 'CUSTOM_AUTH',
            ClientId: USER_POOL_CLIENT_ID,
            AuthParameters: {
                'USERNAME': email
            }
        };
        const response = await cognito.send(new InitiateAuthCommand(authParams));
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                session: response.Session,
                challengeName: response.ChallengeName,
                isNewUser: isNewUser  // Tell the client if this was a new user
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: error.message })
        };
    }
  }
  
  async function handleConfirm(event) {
    try {
        const { email, otp, session, isNewUser  } = JSON.parse(event.body);
        const challengeParams = {
            ChallengeName: 'CUSTOM_CHALLENGE',
            ClientId: USER_POOL_CLIENT_ID,
            ChallengeResponses: {
                'USERNAME': email,
                'ANSWER': otp
            },
            Session: session
        };
        const response = await cognito.send(new RespondToAuthChallengeCommand(challengeParams));
  
        // For new sign-ups, set the account as confirmed
        if (isNewUser ) {
            try {
                const confirmParams = {
                    UserPoolId: USER_POOL_ID,
                    Username: email
                };
                await cognito.send(new AdminConfirmSignUpCommand(confirmParams));
            } catch (confirmError) {
                // If already confirmed, that's fine
                console.log('Error confirming user (may already be confirmed):', confirmError);
            }
        }
  
        // Fetch user attributes
        const getUserParams = {
            UserPoolId: USER_POOL_ID,
            Username: email
        };
        const userAttributesResponse = await cognito.send(new AdminGetUserCommand(getUserParams));
  
        // Initialize attributes object
        const attributes = {};
        userAttributesResponse.UserAttributes.forEach(attr => {
            attributes[attr.Name] = attr.Value;
        });
  
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({
                message: 'Authentication successful',
                isNewUser: isNewUser ,
                tokens: {
                    accessToken: response.AuthenticationResult.AccessToken,
                    idToken: response.AuthenticationResult.IdToken,
                    refreshToken: response.AuthenticationResult.RefreshToken
                },
                attributes: attributes // Include user attributes in the response
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: error.message })
        };
    }
  }
  
  function generateTemporaryPassword() {
    return Math.random().toString(36).slice(2) + 
           Math.random().toString(36).toUpperCase().slice(2);
  }