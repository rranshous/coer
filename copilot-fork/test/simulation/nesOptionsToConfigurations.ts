/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ConfigKey } from '../../src/platform/configuration/common/configurationService';
import { SimulationOptions } from '../base/simulationOptions';
import { Configuration } from '../base/stest';

export function nesOptionsToConfigurations(options: SimulationOptions): Configuration<unknown>[] {
	const configs: Configuration<unknown>[] = [];

	if (options.nesUrl) {
		configs.push({
			key: ConfigKey.Internal.InlineEditsXtabProviderUrl,
			value: options.nesUrl,
		});
	}
	if (options.nesApiKey) {
		configs.push({
			key: ConfigKey.Internal.InlineEditsXtabProviderApiKey,
			value: options.nesApiKey,
		});
	}

	if (options.nesUnifiedModel) {
		configs.push({
			key: ConfigKey.Internal.InlineEditsXtabUseUnifiedModel,
			value: options.nesUnifiedModel,
		});
		configs.push({
			key: ConfigKey.Internal.InlineEditsXtabProviderModelName,
			value: 'xtab-unified-v2',
		});
	}

	return configs;
}
