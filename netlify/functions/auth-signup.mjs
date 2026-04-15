import { createUser, generateToken } from "./lib/storage.mjs";

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
    const { email, password, name } = JSON.parse(event.body);

    if (!email || !password || !name) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email, password, and name are required." }) };
    }

    const { id, email: userEmail, name: userName } = await createUser({ email, password, name });
    const token = generateToken({ _id: id, email: userEmail, name: userName });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        token,
        user: { id, email: userEmail, name: userName }
      }),
    };
  } catch (error) {
    console.error("[Auth] Signup error:", error.message);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
