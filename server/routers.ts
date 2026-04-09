import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { authRouter } from "./routers/auth";
import { syncRouter } from "./routers/sync";
import { storiesRouter } from "./routers/stories";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  sync: syncRouter,
  stories: storiesRouter,
});

export type AppRouter = typeof appRouter;
