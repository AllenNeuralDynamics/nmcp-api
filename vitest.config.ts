import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    include: [
                        "__tests__/*.{test,spec}.ts",
                    ],
                    name: "unit",
                    environment: "node",
                    testTimeout: 60000
                }
            }
        ],
    },
});
