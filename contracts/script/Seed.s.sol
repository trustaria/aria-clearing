// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AriaClearing} from "../src/AriaClearing.sol";
import {Claims} from "./Claims.sol";

/// @notice Creates every campaign in script/campaigns.json that does not exist yet.
/// Reads the contract from deployments/<chainId>.json; the broadcaster becomes the advertiser.
contract Seed is Script {
    function run() external {
        string memory root = vm.projectRoot();
        string memory deployment =
            vm.readFile(string.concat(root, "/../deployments/", vm.toString(block.chainid), ".json"));
        AriaClearing clearing = AriaClearing(vm.parseJsonAddress(deployment, ".address"));
        string memory json = vm.readFile(string.concat(root, "/script/campaigns.json"));

        vm.startBroadcast();
        uint256 created = _seed(clearing, json);
        vm.stopBroadcast();
        console.log("campaigns created", created);
    }

    function _seed(AriaClearing clearing, string memory json) internal returns (uint256 created) {
        uint256 count = _count(json);
        uint256 total;
        for (uint256 i; i < count; ++i) {
            if (!_exists(clearing, json, i)) total += vm.parseJsonUint(json, _key(i, "budget"));
        }
        if (total == 0) return 0;

        IERC20(clearing.usdc()).approve(address(clearing), total);
        for (uint256 i; i < count; ++i) {
            if (_exists(clearing, json, i)) continue;
            string memory slug = vm.parseJsonString(json, _key(i, "slug"));
            clearing.createCampaign(
                keccak256(bytes(slug)),
                Claims.format(vm.parseJsonStringArray(json, _key(i, "claims"))),
                vm.parseJsonUint(json, _key(i, "priceImpression")),
                vm.parseJsonUint(json, _key(i, "priceClick")),
                vm.parseJsonUint(json, _key(i, "budget"))
            );
            console.log("created", slug, vm.toString(keccak256(bytes(slug))));
            ++created;
        }
    }

    function _count(string memory json) private view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat("$[", vm.toString(n), "]"))) {
            ++n;
        }
    }

    function _exists(AriaClearing clearing, string memory json, uint256 i) private view returns (bool) {
        bytes32 id = keccak256(bytes(vm.parseJsonString(json, _key(i, "slug"))));
        return clearing.campaign(id).advertiser != address(0);
    }

    function _key(uint256 i, string memory field) private pure returns (string memory) {
        return string.concat("$[", vm.toString(i), "].", field);
    }
}
