import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['docs/v0.5/reviews/evidence/*.test.ts'],maxWorkers:1}});
