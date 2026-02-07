import { join } from "node:path";
import {
  type BootstrapFromStoreResult,
  LearningLoop,
} from "../../core/learningLoop.js";
import { SimpleWrongTurnMiner } from "../../core/miner.js";
import {
  type ProjectIdentityOverrides,
  resolveProjectIdentity,
} from "../../core/projectIdentity.js";
import type { TraceQuery } from "../../core/types.js";
import { FileTraceStore } from "./fileTraceStore.js";
import { InMemoryLexicalIndex } from "./lexicalIndex.js";

export interface LocalLoopOptions {
  dataDir?: string;
  projectIdentity?: ProjectIdentityOverrides;
}

export interface InitializeLocalLearningLoopOptions extends LocalLoopOptions {
  bootstrapFromStore?: boolean;
  bootstrapQuery?: TraceQuery;
}

export interface InitializedLocalLearningLoop {
  loop: LearningLoop;
  bootstrap: BootstrapFromStoreResult;
}

export function createLocalLearningLoop(options: LocalLoopOptions = {}): LearningLoop {
  const projectIdentity = resolveProjectIdentity(options.projectIdentity);
  const dataDir =
    options.dataDir ?? join(process.cwd(), projectIdentity.defaultDataDirName);

  return new LearningLoop({
    store: new FileTraceStore(dataDir),
    index: new InMemoryLexicalIndex(),
    miner: new SimpleWrongTurnMiner(),
  });
}

export async function initializeLocalLearningLoop(
  options: InitializeLocalLearningLoopOptions = {},
): Promise<InitializedLocalLearningLoop> {
  const loop = createLocalLearningLoop(options);

  if (options.bootstrapFromStore === false) {
    return {
      loop,
      bootstrap: {
        eventCount: 0,
        documentCount: 0,
      },
    };
  }

  const bootstrap = await loop.bootstrapFromStore(options.bootstrapQuery ?? {});
  return {
    loop,
    bootstrap,
  };
}

export { FileTraceStore };
export { InMemoryLexicalIndex };
