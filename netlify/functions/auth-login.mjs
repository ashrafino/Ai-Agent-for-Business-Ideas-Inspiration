import { authenticateUser, generateToken } from "./lib/storage.mjs";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and password are required." }) };
    }

    const user = await authenticateUser(email, password);
    const token = generateToken(user);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token,
        user: { id: user._id, email: user.email, name: user.name }
      }),
    };
  } catch (error) {
    console.error("[Auth] Login error:", error.message);
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
