/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentId } from '../../../platform/inlineEdits/common/dataTypes/documentId';
import { ShowNextEditPreference } from '../../../platform/inlineEdits/common/statelessNextEditProvider';
import { StringReplacement } from '../../../util/vs/editor/common/core/edits/stringEdit';
import { Range } from '../../../util/vs/editor/common/core/range';
import { StringText } from '../../../util/vs/editor/common/core/text/abstractText';
import { NextEditFetchRequest } from './nextEditProvider';

export interface INextEditDisplayLocation {
	range: Range;
	label: string;
}

export interface INextEditResult {
	requestId: number;
	result: {
		edit: StringReplacement;
		showRangePreference?: ShowNextEditPreference;
		displayLocation?: INextEditDisplayLocation;
		targetDocumentId?: DocumentId;
	} | undefined;
}

export class NextEditResult implements INextEditResult {
	constructor(
		public readonly requestId: number,
		public readonly source: NextEditFetchRequest,
		public readonly result: {
			edit: StringReplacement;
			showRangePreference?: ShowNextEditPreference;
			documentBeforeEdits: StringText;
			displayLocation?: INextEditDisplayLocation;
			targetDocumentId?: DocumentId;
		} | undefined,
	) { }
}
