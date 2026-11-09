import * as fs from "fs";
import * as path from "path";

import {RawReconstructionUploadStatus} from "../models/rawReconstructionUploadStatus";

const GraphQLUrl = "http://localhost:4100/graphql";

const UploadMutation = `
mutation UploadRawSwcData($uploadArgs: RawReconstructionUploadArgs!) {
  uploadRawSwcData(uploadArgs: $uploadArgs) {
    id
    annotationId
    attemptNumber
    status
    failureMessage
    qcTag
    skeletonId
    qualityControlUrl
    createdAt
  }
}`;

async function uploadRawSwc(annotationId: string, swcPath: string): Promise<boolean> {
    const filename = path.basename(swcPath);
    const contents = await fs.promises.readFile(swcPath);

    // The GraphQL multipart request spec (graphql-upload): the file variable is null in the operation, and the map
    // names the form part that fills it.
    const form = new FormData();

    form.append("operations", JSON.stringify({
        query: UploadMutation,
        variables: {uploadArgs: {annotationId, file: null}}
    }));
    form.append("map", JSON.stringify({"0": ["variables.uploadArgs.file"]}));
    form.append("0", new Blob([contents]), filename);

    const headers: Record<string, string> = {};

    // Sent unmodified: the API compares an API key against the whole header value.
    if (process.env.NMCP_API_KEY) {
        headers["Authorization"] = process.env.NMCP_API_KEY;
    }

    console.log(`uploading ${swcPath} (${contents.length} bytes) to annotation ${annotationId} at ${GraphQLUrl}`);

    const response = await fetch(GraphQLUrl, {method: "POST", headers, body: form});

    const text = await response.text();

    let body: any;

    try {
        body = JSON.parse(text);
    } catch {
        console.error(`HTTP ${response.status}: ${text}`);
        return false;
    }

    console.log(`HTTP ${response.status}`);
    console.log(JSON.stringify(body, null, 2));

    const attempt = body?.data?.uploadRawSwcData;

    if (attempt) {
        console.log(`attempt ${attempt.attemptNumber} is ${RawReconstructionUploadStatus[attempt.status] ?? attempt.status}`);
    }

    return response.ok && !body?.errors?.length && attempt != null;
}

const cliArguments = process.argv.slice(2);

if (cliArguments.length != 2) {
    console.error("usage: npm run raw-upload -- <annotation-id> <swc-file>");
    console.error("set NMCP_API_KEY to send it as the Authorization header");
    process.exit(1);
}

const [annotationIdArgument, swcArgument] = cliArguments;

const swcFile = path.resolve(process.cwd(), swcArgument);

if (!fs.existsSync(swcFile)) {
    console.error(`${swcFile} does not exist`);
    process.exit(1);
}

uploadRawSwc(annotationIdArgument, swcFile).then((succeeded) => {
    process.exit(succeeded ? 0 : 1);
}).catch((error) => {
    console.error(`raw upload failed: ${error.message}`);
    console.error(error);
    process.exit(1);
});
