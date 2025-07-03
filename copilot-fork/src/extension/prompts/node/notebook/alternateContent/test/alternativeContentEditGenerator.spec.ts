/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { DiffServiceImpl } from '../../../../../../platform/diff/node/diffServiceImpl';
import { ILogger, ILogService } from '../../../../../../platform/log/common/logService';
import { IAlternativeNotebookContentService } from '../../../../../../platform/notebook/common/alternativeContent';
import { AlternativeNotebookContentEditGenerator } from '../../../../../../platform/notebook/common/alternativeContentEditGenerator';
import { BaseAlternativeNotebookContentProvider } from '../../../../../../platform/notebook/common/alternativeContentProvider';
import { AlternativeJsonNotebookContentProvider } from '../../../../../../platform/notebook/common/alternativeContentProvider.json';
import { AlternativeTextNotebookContentProvider } from '../../../../../../platform/notebook/common/alternativeContentProvider.text';
import { AlternativeXmlNotebookContentProvider } from '../../../../../../platform/notebook/common/alternativeContentProvider.xml';
import { NullTelemetryService } from '../../../../../../platform/telemetry/common/nullTelemetryService';
import { AsyncIterableObject } from '../../../../../../util/vs/base/common/async';
import { CancellationToken } from '../../../../../../util/vs/base/common/cancellation';
import { NotebookCellKind, NotebookEdit } from '../../../../../../vscodeTypes';
import { LineOfText } from '../../../../../prompt/node/streamingEdits';
import { fixture, loadFile, loadNotebook } from './utils';

describe('Alternative Content Edit Generator', () => {
	[
		new AlternativeXmlNotebookContentProvider(),
		new AlternativeTextNotebookContentProvider(),
		new AlternativeJsonNotebookContentProvider()
	].forEach((provider) => {
		const mockLogger: ILogger = {
			error: () => { /* no-op */ },
			warn: () => { /* no-op */ },
			info: () => { /* no-op */ },
			debug: () => { /* no-op */ },
			trace: () => { /* no-op */ },
			show: () => { /* no-op */ }
		};
		function getEditGenerator(provider: BaseAlternativeNotebookContentProvider) {
			return new AlternativeNotebookContentEditGenerator(new class implements IAlternativeNotebookContentService {
				declare readonly _serviceBrand: undefined;
				create(_format: any) {
					return provider;
				}
				getFormat() {
					return provider.kind;
				}
			}(), new DiffServiceImpl(), new class implements ILogService {
				_serviceBrand: undefined;
				internal = mockLogger;
				logger = mockLogger;
				showPublicLog(preserveFocus?: boolean): void {
					//
				}
			}(), new NullTelemetryService());
		}
		describe(`${provider.kind} Edit Generator`, () => {
			test(`Generate a single Notebook Edit instead of deleting all when receiving an invalid format`, async () => {
				const file = await loadFile({ filePath: fixture('insert.ipynb') });
				const notebook = await loadNotebook(file);

				const alternativeContents = '# Cell 1: Print a simple number\nprint(1234)';
				const alternativeContentLines = AsyncIterableObject.fromArray(alternativeContents.split(/\r?\n/)).map(l => new LineOfText(l));
				const edits = await getEditGenerator(provider).generateNotebookEdits(notebook, alternativeContentLines, undefined, CancellationToken.None);
				const notebookEdits: NotebookEdit[] = [];
				for await (const edit of edits) {
					if (Array.isArray(edit)) {
						throw new Error('Expected a NotebookEdit, but got TextEdit');
					} else {
						notebookEdits.push(edit);
					}
				}
				expect(notebookEdits.length).toBe(1);
				expect(notebookEdits[0].newCells.length).toBe(1);
				expect(notebookEdits[0].newCells[0].kind).toBe(NotebookCellKind.Code);
				expect(notebookEdits[0].newCells[0].value.split(/\r?\n/g)).toEqual([`# Cell 1: Print a simple number`, `print(1234)`]);
				expect(notebookEdits[0].range.start).toBe(0);
				expect(notebookEdits[0].range.end).toBe(0);
			});
		});
	});
});
