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
const TABLE_NAME = process.env.MENTORS_TABLE_NAME;

// Main handler that routes to the appropriate function based on the HTTP method and path
export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  try {
    // Determine which function to call based on the HTTP method and path
    const httpMethod = event.httpMethod;
    
    if (httpMethod === 'GET') {
      if (event.pathParameters && event.pathParameters.mentor_id) {
        return await getMentorById(event);
      } else {
        return await getMentors(event);
      }
    } else if (httpMethod === 'POST') {
      return await createMentor(event);
    } else if (httpMethod === 'PUT' && event.pathParameters && event.pathParameters.mentor_id) {
      return await updateMentor(event);
    } else if (httpMethod === 'DELETE' && event.pathParameters && event.pathParameters.mentor_id) {
      return await deleteMentor(event);
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

// Get all mentors
async function getMentors() {
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
    console.error('Error fetching mentors:', error);
    throw error;
  }
}

// Get a mentor by ID
async function getMentorById(event) {
  const mentorId = event.pathParameters.mentor_id;
  
  const params = {
    TableName: TABLE_NAME,
    Key: {
      mentor_id: mentorId
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
        body: JSON.stringify({ message: 'Mentor not found' })
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
    console.error('Error fetching mentor:', error);
    throw error;
  }
}

// Create a new mentor
async function createMentor(event) {
  const requestBody = JSON.parse(event.body);
  
  // Generate a unique ID if not provided
  const mentorId = requestBody.mentor_id || uuidv4();
  
  if (!requestBody.name) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: 'Missing required field: name is required' })
    };
  }
  
  const item = {
    mentor_id: mentorId,
    name: requestBody.name,
    expertise: requestBody.expertise || [],
    session_categories: requestBody.session_categories || [],
    created_at: new Date().toISOString()
  };
  
  const params = {
    TableName: TABLE_NAME,
    Item: item
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
    console.error('Error creating mentor:', error);
    throw error;
  }
}

// Update an existing mentor
async function updateMentor(event) {
  const mentorId = event.pathParameters.mentor_id;
  const requestBody = JSON.parse(event.body);
  
  // First, check if the mentor exists
  const getParams = {
    TableName: TABLE_NAME,
    Key: {
      mentor_id: mentorId
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
        body: JSON.stringify({ message: 'Mentor not found' })
      };
    }
    
    // Build update expression
    let updateExpression = 'SET';
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    
    if (requestBody.name) {
      updateExpression += ' #name = :name,';
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = requestBody.name;
    }
    
    if (requestBody.expertise) {
      updateExpression += ' #expertise = :expertise,';
      expressionAttributeNames['#expertise'] = 'expertise';
      expressionAttributeValues[':expertise'] = requestBody.expertise;
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
        mentor_id: mentorId
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
    console.error('Error updating mentor:', error);
    throw error;
  }
}

// Delete a mentor
async function deleteMentor(event) {
  const mentorId = event.pathParameters.mentor_id;
  
  const params = {
    TableName: TABLE_NAME,
    Key: {
      mentor_id: mentorId
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
    console.error('Error deleting mentor:', error);
    throw error;
  }
}