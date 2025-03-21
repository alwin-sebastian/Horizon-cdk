import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  GetCommand, 
  PutCommand, 
  UpdateCommand, 
  DeleteCommand 
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.STARTUPS_TABLE_NAME;

// Main handler that routes to the appropriate function based on the HTTP method and path
export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Determine which function to call based on the HTTP method and path
    const httpMethod = event.httpMethod;
    
    if (httpMethod === 'GET') {
      if (event.pathParameters && event.pathParameters.startup_name) {
        return await getStartupByName(event);
      } else {
        return await getStartups(event);
      }
    } else if (httpMethod === 'POST') {
      return await createStartup(event);
    } else if (httpMethod === 'PUT' && event.pathParameters && event.pathParameters.startup_name) {
      return await updateStartup(event);
    } else if (httpMethod === 'DELETE' && event.pathParameters && event.pathParameters.startup_name) {
      return await deleteStartup(event);
    } else {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'Invalid request' })
      };
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};

// Get all startups
async function getStartups() {
  const params = {
    TableName: TABLE_NAME
  };
  
  try {
    const { Items } = await ddbDocClient.send(new ScanCommand(params));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(Items)
    };
  } catch (error) {
    console.error('Error fetching startups:', error);
    throw error;
  }
}

// Get a startup by name
async function getStartupByName(event) {
  const startupName = decodeURIComponent(event.pathParameters.startup_name);
  
  const params = {
    TableName: TABLE_NAME,
    Key: {
      startup_name: startupName
    }
  };
  
  try {
    const { Item } = await ddbDocClient.send(new GetCommand(params));
    
    if (!Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'Startup not found' })
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(Item)
    };
  } catch (error) {
    console.error('Error fetching startup:', error);
    throw error;
  }
}

// Create a new startup
async function createStartup(event) {
  const requestBody = JSON.parse(event.body);
  
  if (!requestBody.startup_name || !requestBody.summary) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: 'Missing required fields: startup_name and summary are required' })
    };
  }
  
  const item = {
    startup_name: requestBody.startup_name,
    summary: requestBody.summary,
    session_categories: requestBody.session_categories || [],
    created_at: new Date().toISOString()
  };
  
  const params = {
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(startup_name)'
  };
  
  try {
    await ddbDocClient.send(new PutCommand(params));
    
    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(item)
    };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'A startup with this name already exists' })
      };
    }
    
    console.error('Error creating startup:', error);
    throw error;
  }
}

// Update an existing startup
async function updateStartup(event) {
  const startupName = decodeURIComponent(event.pathParameters.startup_name);
  const requestBody = JSON.parse(event.body);
  
  // First, check if the startup exists
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      startup_name: startupName
    }
  };
  
  try {
    const { Item } = await ddbDocClient.send(new GetCommand(getParams));
    
    if (!Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'Startup not found' })
      };
    }
    
    // Build update expression
    let updateExpression = 'SET';
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    
    if (requestBody.summary) {
      updateExpression += ' #summary = :summary,';
      expressionAttributeNames['#summary'] = 'summary';
      expressionAttributeValues[':summary'] = requestBody.summary;
    }
    
    if (requestBody.session_categories) {
      updateExpression += ' #session_categories = :session_categories,';
      expressionAttributeNames['#session_categories'] = 'session_categories';
      expressionAttributeValues[':session_categories'] = requestBody.session_categories;
    }
    
    // Add updatedAt timestamp
    updateExpression += ' #updated_at = :updated_at';
    expressionAttributeNames['#updated_at'] = 'updated_at';
    expressionAttributeValues[':updated_at'] = new Date().toISOString();
    
    const updateParams = {
      TableName: TABLE_NAME,
      Key: {
        startup_name: startupName
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    
    const { Attributes } = await ddbDocClient.send(new UpdateCommand(updateParams));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(Attributes)
    };
  } catch (error) {
    console.error('Error updating startup:', error);
    throw error;
  }
}

// Delete a startup
async function deleteStartup(event) {
  const startupName = decodeURIComponent(event.pathParameters.startup_name);
  
  const params = {
    TableName: TABLE_NAME,
    Key: {
      startup_name: startupName
    }
  };
  
  try {
    await ddbDocClient.send(new DeleteCommand(params));
    
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    };
  } catch (error) {
    console.error('Error deleting startup:', error);
    throw error;
  }
}