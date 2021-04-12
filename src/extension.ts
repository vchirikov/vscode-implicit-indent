import * as vscode from "vscode";
import { Mutex } from "async-mutex";
import { Position, TextEditorSelectionChangeEvent } from "vscode";

export declare let prevClickLine: number | undefined;
export declare let lock: Mutex;

const options = { undoStopAfter: false, undoStopBefore: false };

export function deactivate() { }

export function activate(context: vscode.ExtensionContext) {
  // Because we use await in our async functions, we need a mutex/lock to
  // prevent concurrent executions of any of our movement commands.
  // If we did not do so, then any fast key repeats cause bugs due to some
  // executions of our function invalidating the working assumptions of others
  // that are executing concurrently. Using a lock lets us not worry about that.
  if (!lock) {
    lock = new Mutex();
  }

  // Define some movement commands, registered with the implicit-indent prefix.
  const moveCommands = ["cursorUp", "cursorDown", "cursorLeft", "cursorRight"];
  moveCommands.forEach((moveCommand) => {
    const name = `implicit-indent.${moveCommand}`;
    const disposable = vscode.commands.registerCommand(name, async () => {
      // Get the cursor's current line and check if it is empty.
      const editor = vscode.window.activeTextEditor!;
      const position = editor.selection.start;
      const line = position.line;
      await executeIndentAndClear(editor, position, line, moveCommand);
    });
    context.subscriptions.push(disposable);
  });

  vscode.window.onDidChangeTextEditorSelection(
    async (event: TextEditorSelectionChangeEvent) => {
      // Get the cursor's current line and check if it is empty.
      const editor = vscode.window.activeTextEditor!;
      const position = editor.selection.start;
      const line = position.line;
      if (prevClickLine == line) {
        return;
      }

      await executeIndentAndClear(editor, position, line, "");
      prevClickLine = line;
    }
  );
}

async function executeIndentAndClear(
  editor: vscode.TextEditor,
  position: Position,
  line: number,
  moveCommand: string
) {
  // First, wait to acquire the lock before doing anything.
  const releaseLock = await lock.acquire();
  try {

    const document = editor.document;
    const isMouseCommand = moveCommand === "";
    const prevLineText = editor.document.lineAt(line);

    // We will remove spaces in whitespace-only lines only after keys movements
    let shouldDeletePrevLineWhitespace = !isMouseCommand && prevLineText.text !== "" && prevLineText.isEmptyOrWhitespace;
    let indent = 0;

    // Execute the underlying movement command associated with this command.
    if (!isMouseCommand) {
      await vscode.commands.executeCommand(moveCommand);
    }

    const newPosition = isMouseCommand ? position : editor.selection.start;
    const newLine = newPosition.line;
    let newLineText = isMouseCommand ? prevLineText.text : document.lineAt(newLine).text;

    if (newLineText === '') {
      try {
        for (let i = newLine + 1; i < document.lineCount; ++i) {
          const line = document.lineAt(i);
          if (line.isEmptyOrWhitespace) {
            continue;
          }
          indent = line.firstNonWhitespaceCharacterIndex;
          break;
        }
      } catch (e) {
        indent = 0;
      }

      if (indent > 0) {
        editor.edit((edit) => {
          // don't use edit.replace here because it doesn't use forceMoveMarkers
          if (shouldDeletePrevLineWhitespace) {
            edit.delete(prevLineText.range);
          }
          edit.insert(newPosition, ' '.repeat(indent));
        }, options);
      }
    }
    else if (indent == 0 && shouldDeletePrevLineWhitespace) {
      editor.edit((edit) => {
        edit.delete(prevLineText.range);
      }, options);
    }

  } finally {
    releaseLock();
  }
}
