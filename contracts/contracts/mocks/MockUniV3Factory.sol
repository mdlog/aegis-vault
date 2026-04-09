// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test helper that pretends to be a Uniswap V3 Factory + Pool.
///         Returns a configurable pool address per (tokenA, tokenB, fee) tuple
///         and a configurable liquidity per pool.
contract MockUniV3Factory {
    // (sortedA, sortedB, fee) → pool address
    mapping(bytes32 => address) public pools;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pools[keccak256(abi.encode(t0, t1, fee))] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return pools[keccak256(abi.encode(t0, t1, fee))];
    }
}

contract MockUniV3Pool {
    uint128 public liquidity;

    constructor(uint128 _liquidity) {
        liquidity = _liquidity;
    }

    function setLiquidity(uint128 _liq) external {
        liquidity = _liq;
    }
}
