// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Emits the IAriaClearing events with caller-supplied values, for receipt tests.
contract Emitter {
    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed advertiser,
        string claims,
        bytes32 claimsHash,
        uint256 priceImpression,
        uint256 priceClick,
        uint256 budget
    );
    event EventLogged(
        bytes32 indexed eventId,
        bytes32 indexed requestKey,
        bytes32 indexed campaignId,
        string requestId,
        address publisher,
        uint8 kind,
        string rationale,
        bytes32 rationaleHash,
        uint8[] claimRefs,
        uint256 price
    );
    event EventDisputed(bytes32 indexed eventId);
    event EventSettled(bytes32 indexed eventId, uint8 outcome);

    function campaignCreated(bytes32 campaignId, string calldata claims, bytes32 claimsHash) external {
        emit CampaignCreated(campaignId, msg.sender, claims, claimsHash, 10_000, 250_000, 5_000_000);
    }

    function eventLogged(
        bytes32 eventId,
        bytes32 campaignId,
        string calldata requestId,
        uint8 kind,
        string calldata rationale,
        bytes32 rationaleHash,
        uint8[] calldata claimRefs
    ) external {
        emit EventLogged(
            eventId, keccak256(bytes(requestId)), campaignId, requestId, msg.sender, kind, rationale, rationaleHash, claimRefs, 10_000
        );
    }

    function eventDisputed(bytes32 eventId) external {
        emit EventDisputed(eventId);
    }

    function eventSettled(bytes32 eventId, uint8 outcome) external {
        emit EventSettled(eventId, outcome);
    }
}
