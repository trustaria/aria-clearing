// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Builds the claims string of the hash recipe: "1. a\n2. b", no trailing newline.
library Claims {
    function format(string[] memory claims) internal pure returns (string memory out) {
        for (uint256 i; i < claims.length; ++i) {
            string memory line = string.concat(Strings.toString(i + 1), ". ", claims[i]);
            out = i == 0 ? line : string.concat(out, "\n", line);
        }
    }
}
