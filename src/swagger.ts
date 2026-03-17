import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";

// Dynamically resolve the server URL:
// - On Railway: use RAILWAY_PUBLIC_DOMAIN env var injected by Railway
// - Fallback: localhost for local dev
const host = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3000}`;

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Code Session API",
      version: "1.0.0",
      description: "API for managing Code Sessions and Executions",
    },
    servers: [
      {
        url: host,
        description: process.env.RAILWAY_PUBLIC_DOMAIN ? "Railway deployment" : "Local development server",
      },
    ],
  },
  apis: [
    "./src/controllers/*.ts",
    "./dist/controllers/*.js"
  ],
};

const swaggerSpec = swaggerJSDoc(options);

export const setupSwagger = (app: Express) => {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};