import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { segmentationService } from "../segmentationService";

export const storiesRouter = router({
  segmentStory: publicProcedure
    .input(z.object({ chineseText: z.string() }))
    .query(({ input }) => {
      const tokens = segmentationService.segmentText(input.chineseText);
      return { tokens };
    }),
});
