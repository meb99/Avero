#pragma once
#include <memory>
#include <vector>
#include <cstdint>

// A owned, zero-padded file buffer replaces the upstream Boost mapping.
// The parser's pointers remain stable for the lifetime of File.
class mapped_region {
    std::shared_ptr<std::vector<uint8_t>> bytes;
    size_t size;
public:
    explicit mapped_region(size_t n) : bytes(std::make_shared<std::vector<uint8_t>>(n + 4096)), size(n) {}
    void* get_address() const { return bytes->data(); }
    size_t get_size() const { return size; }
};
