import NextAuth, { NextAuthConfig } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

// Validate required environment variables
if (!process.env.AZURE_AD_CLIENT_ID) {
  throw new Error("AZURE_AD_CLIENT_ID environment variable is not set");
}
if (!process.env.AZURE_AD_CLIENT_SECRET) {
  throw new Error("AZURE_AD_CLIENT_SECRET environment variable is not set");
}
if (!process.env.AZURE_AD_TENANT_ID) {
  throw new Error("AZURE_AD_TENANT_ID environment variable is not set");
}
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable is not set");
}

const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "@sparqsys.com";

export const authConfig: NextAuthConfig = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      // Use tenant-specific endpoint instead of /common
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read",
        },
      },
    }),
  ],

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  callbacks: {
    async signIn({ user }) {
      // Validate email domain
      const email = user.email || "";

      if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
        console.warn(`Sign-in attempt blocked for email: ${email}`);
        return false;
      }

      console.log(`Sign-in allowed for: ${email}`);
      return true;
    },

    async jwt({ token, user }) {
      // Add user info to token on initial sign-in
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }

      return token;
    },

    async session({ session, token }) {
      // Add user info from token to session
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
      }

      return session;
    },
  },

  cookies: {
    sessionToken: {
      name: "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  debug: process.env.NODE_ENV === "development",
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
