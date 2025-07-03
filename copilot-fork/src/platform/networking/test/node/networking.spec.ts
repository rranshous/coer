/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from '@vscode/copilot-api';
import assert from 'assert';
import { suite, test } from 'vitest';
import { ICAPIClientService } from '../../../endpoint/common/capiClient';
import { IDomainService } from '../../../endpoint/common/domainService';
import { IEnvService } from '../../../env/common/envService';
import { ITelemetryService } from '../../../telemetry/common/telemetry';
import { createFakeResponse } from '../../../test/node/fetcher';
import { createPlatformServices } from '../../../test/node/services';
import { FetchOptions, IAbortController, IFetcherService, Response } from '../../common/fetcherService';
import { postRequest } from '../../common/networking';

suite('Networking test Suite', function () {

	let headerBuffer: { [name: string]: string } | undefined;

	class StaticFetcherService implements IFetcherService {

		declare readonly _serviceBrand: undefined;

		getUserAgentLibrary(): string {
			return 'test';
		}
		fetch(url: string, options: FetchOptions): Promise<Response> {
			headerBuffer = options.headers;
			return Promise.resolve(createFakeResponse(200));
		}
		disconnectAll(): Promise<unknown> {
			throw new Error('Method not implemented.');
		}
		makeAbortController(): IAbortController {
			throw new Error('Method not implemented.');
		}
		isAbortError(e: any): boolean {
			throw new Error('Method not implemented.');
		}
		isInternetDisconnectedError(e: any): boolean {
			throw new Error('Method not implemented.');
		}
		isFetcherError(e: any): boolean {
			throw new Error('Method not implemented.');
		}
		getUserMessageForFetcherError(err: any): string {
			throw new Error('Method not implemented.');
		}
	}

	test('each request contains editor info headers', async function () {
		const testingServiceCollection = createPlatformServices();
		testingServiceCollection.define(IFetcherService, new StaticFetcherService());
		const accessor = testingServiceCollection.createTestingAccessor();
		await postRequest(
			accessor.get(IFetcherService),
			accessor.get(IEnvService),
			accessor.get(ITelemetryService),
			accessor.get(IDomainService),
			accessor.get(ICAPIClientService),
			{ type: RequestType.Models },
			'',
			'',
			'test',
			'id'
		);

		assert.strictEqual(headerBuffer!['VScode-SessionId'], 'test-session');
		assert.strictEqual(headerBuffer!['VScode-MachineId'], 'test-machine');
		assert.strictEqual(headerBuffer!['Editor-Version'], `vscode/test-version`);
	});
});
