import math

def combine_ratings(ratings):
    ratings = sorted(ratings, reverse=True)
    combined = 0
    for r in ratings:
        combined = combined + (100 - combined) * (r / 100)
    return combined

def round_va(value):
    return int(math.floor((value + 5) / 10) * 10)

def apply_bilateral(left, right):
    if not left or not right:
        return 0
    combined = combine_ratings(left + right)
    bilateral_bonus = combined * 0.10
    return combined + bilateral_bonus

def main():
    print("=== VA Disability Calculator ===")
    
    ratings = list(map(int, input("Enter ratings (comma separated): ").split(",")))

    bilateral = input("Any bilateral? (y/n): ").lower()
    
    if bilateral == "y":
        left = list(map(int, input("Left side ratings: ").split(",")))
        right = list(map(int, input("Right side ratings: ").split(",")))
        
        bilateral_value = apply_bilateral(left, right)
        remaining = [r for r in ratings if r not in left + right]
        
        total = combine_ratings([bilateral_value] + remaining)
    else:
        total = combine_ratings(ratings)

    final = round_va(total)

    print(f"\nRaw Combined: {total:.2f}%")
    print(f"Final VA Rating: {final}%")

if __name__ == "__main__":
    main()
